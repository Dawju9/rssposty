import { OllamaClient } from './ollama-client.js';
import { ConfigManager } from './config-manager.js';
import { WebSearcher } from './web-searcher.js';
import { RSSFetcher } from './rss-fetcher.js';
import { ArticleSourceManager } from './article-source.js';
import { WordPressManager } from './wordpress-manager.js';
import { ArticleDatabase } from './database.js';
import { Logger, CacheManager } from './utils/cache.js';
import { RateLimiter, ArticleDeduplicator, DateFilter } from './utils/validation.js';

export class RCAgent {
  constructor(options = {}) {
    this.configPath = options.configPath || null;
    this.configManager = new ConfigManager(this.configPath);
    this.ollamaClient = null;
    this.wpManager = null;
    this.db = null;
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

    this.sourceManager = new ArticleSourceManager({
      sources: ['duckduckgo', 'rss'],
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

    if (this.config.database?.enabled) {
      this.db = new ArticleDatabase({
        enabled: true,
        path: this.config.database.path
      });
      this.db.initialize();
      this.logger.info('Database initialized');
    }

    const wpConfig = this.configManager.getWordPressConfig();
    if (wpConfig?.url && wpConfig?.auth) {
      this.wpManager = new WordPressManager({
        url: wpConfig.url,
        auth: wpConfig.auth,
        retryAttempts: this.config.wordpress?.retryAttempts || 3,
        categories: this.config.publish?.categories || []
      });
      this.logger.info('WordPress manager initialized');
    }

    this.logger.info('RCAgent initialized');
  }

  async fetch(options = {}) {
    const keywords = options.keywords || this.configManager.getKeywords();
    const searchConfig = this.configManager.getSearchConfig();
    const rssConfig = this.configManager.getRSSConfig();

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

    for (const keyword of keywords) {
      try {
        this.logger.info('Searching web', { keyword });
        const articles = await this.sourceManager.search(keyword, { useCache: true });
        results.web.push(...articles);
      } catch (error) {
        this.logger.error('Web search failed', { keyword, error: error.message });
      }
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

    if (this.db) {
      for (const article of allArticles) {
        await this.db.saveArticle(article);
      }
    }

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

    const articles = await this.sourceManager.fetchMultiple(urls, { concurrency });

    for (const article of articles) {
      if (!article.success) {
        const originalArticle = this.articles.find(a => a.url === article.url);
        if (originalArticle && originalArticle.description && originalArticle.description.length > 50) {
          article.title = originalArticle.title;
          article.content = originalArticle.description;
          article.excerpt = originalArticle.description.substring(0, 200);
          article.success = true;
          this.logger.info('Using RSS description as fallback', { url: article.url });
        }
      }
    }

    for (const fetchedArticle of articles) {
      const index = this.articles.findIndex(a => a.url === fetchedArticle.url);
      if (index !== -1) {
        this.articles[index] = {
          ...this.articles[index],
          ...fetchedArticle,
          content: fetchedArticle.content || this.articles[index].description || ''
        };
      }
    }

    const successful = articles.filter(a => a.success);
    this.logger.info('Article content fetched', { requested: urls.length, success: successful.length });

    if (this.db) {
      for (const article of this.articles) {
        await this.db.saveArticle(article);
      }
    }

    return articles;
  }

  async publish(options = {}) {
    if (!this.wpManager) {
      throw new Error('WordPress not configured. Configure endpoints.wordpress in config.');
    }

    const publishConfig = this.configManager.getPublishConfig();
    const articles = options.articles || this.articles;

    if (!articles || articles.length === 0) {
      throw new Error('No articles to publish. Run "fetch" first.');
    }

    const articlesWithContent = articles.filter(a => a.content?.length > 50);

    if (publishConfig.dryRun) {
      this.logger.info('[DRY RUN] Would publish articles:', { count: articlesWithContent.length });
      return {
        results: articlesWithContent.map(a => ({ url: a.url, title: a.title, status: 'dry-run' })),
        summary: { published: 0, failed: 0, skipped: 0, total: articlesWithContent.length }
      };
    }

    const { results, summary } = await this.wpManager.publishMultiple(articlesWithContent);

    for (const result of results) {
      if (result.status === 'published' && this.db) {
        await this.db.markAsPublished(result.url, result.postId);
      } else if (result.status === 'failed' && this.db) {
        await this.db.markAsFailed(result.url, result.error);
      }
    }

    this.logger.info('Publishing completed', summary);

    if (this.db) {
      await this.db.recordDailyStats(summary);
    }

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

  async testWordPressConnection() {
    if (!this.wpManager) {
      return { success: false, error: 'WordPress not configured' };
    }
    return await this.wpManager.testConnection();
  }

  async getStats() {
    const configStatus = this.configManager.getStatus();
    const rssConfig = this.configManager.getRSSConfig();
    const searchConfig = this.configManager.getSearchConfig();
    const publishConfig = this.configManager.getPublishConfig();

    let dbStats = null;
    if (this.db) {
      dbStats = await this.db.getStats();
    }

    return {
      config: configStatus,
      keywords: this.configManager.getKeywords(),
      rss: rssConfig,
      search: searchConfig,
      publish: publishConfig,
      articlesCount: this.articles.length,
      ollama: this.ollamaClient ? 'connected' : 'disconnected',
      wordpress: this.wpManager ? 'configured' : 'not configured',
      cache: this.cache.enabled,
      database: dbStats,
      uptime: process.uptime()
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

  async cleanupDatabase(maxAgeDays = 30) {
    if (!this.db) return 0;
    const deleted = await this.db.cleanup(maxAgeDays);
    this.logger.info('Database cleanup completed', { deleted });
    return deleted;
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

export default RCAgent;
