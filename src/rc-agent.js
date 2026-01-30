import { OllamaClient } from './ollama-client.js';
import { ConfigManager } from './config-manager.js';
import { WebSearcher } from './web-searcher.js';
import { RSSFetcher } from './rss-fetcher.js';
import { Logger, CacheManager } from './utils/cache.js';
import { RateLimiter, ArticleDeduplicator, DateFilter } from './utils/validation.js';

export class RCAgent {
  constructor(options = {}) {
    this.configPath = options.configPath || null;
    this.configManager = new ConfigManager(this.configPath);
    this.ollamaClient = null;
    this.config = null;
    this.articles = [];

    this.logger = new Logger({
      level: options.logLevel || 'info',
      fileEnabled: options.logFile !== false
    });

    this.cache = new CacheManager({ enabled: options.cache !== false });
    this.rateLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60000 });
    this.deduplicator = new ArticleDeduplicator();

    this.webSearcher = new WebSearcher({
      logger: this.logger,
      cache: this.cache
    });

    this.rssFetcher = new RSSFetcher({
      logger: this.logger,
      cache: this.cache
    });
  }

  async initialize() {
    this.config = await this.configManager.loadConfig();
    const validation = this.configManager.validateConfig();

    if (validation.errors.length > 0) {
      this.logger.error('Config validation failed', { errors: validation.errors });
      throw new Error(`Config validation failed: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
      this.logger.warn('Config warnings', { warnings: validation.warnings });
    }

    if (this.config.ollama?.baseUrl && this.config.ollama?.model) {
      this.ollamaClient = new OllamaClient(
        this.config.ollama.baseUrl,
        this.config.ollama.model
      );

      try {
        await this.ollamaClient.checkConnection();
        this.logger.info('Ollama connected');
      } catch (error) {
        this.logger.warn('Ollama not available', { error: error.message });
      }
    }

    this.logger.info('RCAgent initialized');
  }

  async fetch(options = {}) {
    const keywords = options.keywords || this.configManager.getKeywords();
    const searchConfig = this.configManager.getSearchConfig();
    const rssConfig = this.configManager.getRSSConfig();
    const publishConfig = this.configManager.getPublishConfig();

    this.logger.info('Starting fetch', { keywords: keywords.length, options });

    if (keywords.length === 0) {
      throw new Error('No keywords configured. Add keywords to config.');
    }

    const results = {
      rss: null,
      web: [],
      total: 0,
      errors: []
    };

    try {
      this.logger.info('Fetching RSS feeds');
      results.rss = await this.rssFetcher.fetchKeywordFeeds(keywords, {
        maxItemsPerFeed: 5,
        maxTotalItems: searchConfig.maxResults,
        googleNews: rssConfig.googleNews,
        customFeeds: rssConfig.customFeeds
      });
    } catch (error) {
      this.logger.error('RSS fetch failed', { error: error.message });
      results.errors.push({ source: 'rss', error: error.message });
    }

    try {
      this.logger.info('Searching web');
      results.web = await this.webSearcher.searchWeb(keywords, {
        maxResults: searchConfig.maxResults,
        useCache: true
      });
    } catch (error) {
      this.logger.error('Web search failed', { error: error.message });
      results.errors.push({ source: 'web', error: error.message });
    }

    let allArticles = [...(results.rss?.items || []), ...results.web];

    this.deduplicator.reset();
    allArticles = allArticles.filter(article => !this.deduplicator.isDuplicate(article));

    if (searchConfig.maxAgeDays) {
      allArticles = DateFilter.filterByAge(allArticles, {
        maxAge: searchConfig.maxAgeDays * 24 * 60 * 60 * 1000,
        maxArticles: searchConfig.maxResults * 2
      });
    }

    allArticles = allArticles.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0).getTime();
      const dateB = new Date(b.publishedAt || 0).getTime();
      return dateB - dateA;
    });

    this.articles = allArticles;
    results.total = allArticles.length;

    this.logger.info('Fetch completed', {
      rss: results.rss?.items?.length || 0,
      web: results.web.length,
      total: results.total
    });

    return results;
  }

  async fetchArticleContent(options = {}) {
    const concurrency = options.concurrency || 3;
    const maxResults = options.maxResults || 10;
    const urls = options.urls || this.articles.map(a => a.url).filter(Boolean);

    if (urls.length === 0) {
      this.logger.warn('No URLs to fetch');
      return [];
    }

    const articles = await this.webSearcher.fetchMultiple(urls, {
      concurrency,
      maxResults,
      useCache: true
    });

    const successful = articles.filter(a => a.success);
    this.logger.info('Article content fetched', { requested: urls.length, success: successful.length });

    return articles;
  }

  async publish(options = {}) {
    const publishConfig = this.configManager.getPublishConfig();
    const wpConfig = this.configManager.getWordPressConfig();

    if (!wpConfig) {
      throw new Error('WordPress not configured. Configure endpoints.wordpress in config.');
    }

    const articles = options.articles || this.articles;

    if (!articles || articles.length === 0) {
      throw new Error('No articles to publish. Run "fetch" first.');
    }

    const auth = Buffer.from(`${wpConfig.auth.username}:${wpConfig.auth.password}`).toString('base64');
    const results = [];
    let published = 0;
    let failed = 0;
    let skipped = 0;

    this.logger.info(`Publishing ${articles.length} articles`, {
      dryRun: publishConfig.dryRun,
      categories: publishConfig.categories
    });

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const title = article.title?.substring(0, 200) || 'No title';
      const content = article.content || article.description || article.excerpt || '';
      const categories = publishConfig.categories || article.categories || [];

      if (content.length < 50) {
        this.logger.warn('Skipping article - too short', { title: title.substring(50) });
        skipped++;
        continue;
      }

      if (publishConfig.dryRun) {
        this.logger.info(`[DRY RUN] Would publish: ${title.substring(50)}...`);
        results.push({ url: article.url, title, status: 'skipped', reason: 'dry-run' });
        skipped++;
        continue;
      }

      await this.rateLimiter.acquire('wordpress');

      try {
        const response = await fetch(wpConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
          },
          body: JSON.stringify({
            title,
            content,
            status: 'publish',
            categories: categories.map(c => ({ name: c }))
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        published++;
        this.logger.info(`Published: ${title.substring(50)}...`);
        results.push({
          url: article.url,
          postId: result.id,
          link: result.link,
          title,
          status: 'published'
        });
      } catch (error) {
        failed++;
        this.logger.error(`Publish failed: ${title.substring(50)}...`, { error: error.message });
        results.push({
          url: article.url,
          title,
          status: 'failed',
          error: error.message
        });
      }
    }

    const summary = { published, failed, skipped, total: articles.length };
    this.logger.info('Publishing completed', summary);

    return { results, summary };
  }

  async generateArticle(keywords = null, style = null) {
    if (!this.ollamaClient) {
      throw new Error('Ollama not configured. Set ollama.baseUrl and ollama.model in config.');
    }

    const articleKeywords = keywords || this.configManager.getKeywords().slice(0, 3);
    const articleStyle = style || this.config.article?.style || 'professional';

    this.logger.info('Generating article', { keywords: articleKeywords, style: articleStyle });

    const article = await this.ollamaClient.generateArticle(articleKeywords, articleStyle);

    this.logger.info('Article generated');
    return article;
  }

  async postToTelegram(message) {
    const tgConfig = this.config?.endpoints?.telegram;

    if (!tgConfig?.botToken || !tgConfig?.channelId) {
      throw new Error('Telegram not configured');
    }

    await this.rateLimiter.acquire('telegram');

    const url = `https://api.telegram.org/bot${tgConfig.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgConfig.channelId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status}`);
    }

    this.logger.info('Message sent to Telegram');
    return { status: 'sent' };
  }

  getStatus() {
    const configStatus = this.configManager.getStatus();
    const rssConfig = this.configManager.getRSSConfig();
    const searchConfig = this.configManager.getSearchConfig();
    const publishConfig = this.configManager.getPublishConfig();

    return {
      config: configStatus,
      keywords: this.configManager.getKeywords(),
      rss: rssConfig,
      search: searchConfig,
      publish: publishConfig,
      articlesCount: this.articles.length,
      ollama: this.ollamaClient ? 'connected' : 'disconnected',
      cache: this.cache.enabled
    };
  }

  getArticles() {
    return this.articles;
  }

  setArticles(articles) {
    this.articles = articles || [];
  }

  clearArticles() {
    this.articles = [];
  }

  async clearCache() {
    await this.cache.clear();
    this.logger.info('Cache cleared');
  }

  async backupConfig() {
    const backupPath = await this.configManager.backupConfig();
    this.logger.info('Config backed up', { path: backupPath });
    return backupPath;
  }
}
