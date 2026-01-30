import axios from 'axios';
import { JSDOM } from 'jsdom';
import { URLValidator, RateLimiter, ArticleDeduplicator, DateFilter } from './utils/validation.js';
import { CacheManager } from './utils/cache.js';

export class WebSearcher {
  constructor(options = {}) {
    this.client = axios.create({
      timeout: options.timeout || 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    this.delayMs = options.delayMs || 1000;
    this.rateLimiter = new RateLimiter({
      maxRequests: options.maxRequests || 10,
      windowMs: options.windowMs || 60000
    });

    this.deduplicator = new ArticleDeduplicator();
    this.cache = new CacheManager({ enabled: options.cache !== false });
    this.logger = options.logger || {
      log: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  log(level, message, meta = {}) {
    this.logger.log(level, message, meta);
  }

  async searchWeb(keywords, options = {}) {
    if (!keywords || keywords.length === 0) {
      this.log('warn', 'No keywords provided for web search');
      return [];
    }

    const maxResults = options.maxResults || 10;
    const useCache = options.useCache !== false;

    const results = [];
    this.deduplicator.reset();

    for (const keyword of keywords) {
      await this.rateLimiter.acquire('search');
      await this.delay(this.delayMs);

      try {
        const articles = await this.searchByKeyword(keyword, useCache);
        const filtered = this.deduplicator.filter(articles);

        for (const article of filtered) {
          if (results.length >= maxResults) break;
          results.push(article);
        }
      } catch (error) {
        this.log('warn', `Web search failed for "${keyword}"`, { error: error.message });
      }
    }

    this.log('info', `Web search completed`, { keywords: keywords.length, results: results.length });
    return results;
  }

  async searchByKeyword(keyword, useCache = true) {
    const cacheKey = `search_${keyword}_duckduckgo`;

    if (useCache) {
      const cached = await this.cache.get(cacheKey);
        if (cached) {
          this.log('debug', `Cache hit for "${keyword}"`);
          return cached;
        }
    }

    const results = [];
    const encodedKeyword = encodeURIComponent(keyword);

    try {
      this.log('debug', `Searching DuckDuckGo for "${keyword}"`);

      const searchUrl = `https://duckduckgo.com/html/?q=${encodedKeyword}&kl=us-en`;
      const response = await this.client.get(searchUrl);

      const dom = new JSDOM(response.data);
      const document = dom.window.document;
      const links = document.querySelectorAll('a.result__a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.textContent?.trim();

        if (href && title && href.startsWith('http') && !href.includes('duckduckgo')) {
          const validation = URLValidator.validate(href);
          if (validation.valid) {
            results.push({
              title,
              url: href,
              keyword,
              source: 'duckduckgo',
              publishedAt: null
            });
          }
        }
        if (results.length >= 5) break;
      }

      if (useCache && results.length > 0) {
        await this.cache.set(cacheKey, results);
      }
      } catch (error) {
        this.log('warn', `DuckDuckGo search failed for "${keyword}"`, { error: error.message });
      }

    return results;
  }

  async fetchArticle(url, options = {}) {
    if (!url) {
      throw new Error('URL is required');
    }

    const validation = URLValidator.validate(url);
    if (!validation.valid) {
      throw new Error(`Invalid URL: ${validation.error}`);
    }

    const useCache = options.useCache !== false;

    if (useCache) {
      const cacheKey = await this.cache.getArticleCacheKey(url);
      const cached = await this.cache.get(cacheKey);
        if (cached) {
          this.log('debug', `Cache hit for article`, { url });
          cached._fromCache = true;
          return cached;
        }
    }

    await this.rateLimiter.acquire('fetch');

    try {
      const response = await this.client.get(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      const title = this.extractTitle(document) || 'No title';
      const content = this.extractContent(document) || '';
      const meta = this.extractMeta(document);

      const article = {
        url,
        title: String(title).substring(0, 500),
        content: String(content).substring(0, 50000),
        excerpt: String(meta.description || content || '').substring(0, 500),
        publishedAt: meta.publishedAt || new Date().toISOString(),
        author: meta.author,
        siteName: meta.siteName,
        fetchedAt: new Date().toISOString(),
        source: 'web'
      };

      if (useCache) {
        const cacheKey = await this.cache.getArticleCacheKey(url);
        await this.cache.set(cacheKey, article);
      }

      this.log('debug', `Article fetched`, { url: article.url, title: article.title.substring(0, 50) });
      return article;
    } catch (error) {
      this.log('error', `Failed to fetch article`, { url, error: error.message });
      throw new Error(`Failed to fetch article "${url}": ${error.message}`);
    }
  }

  extractTitle(document) {
    if (!document) return null;

    const selectors = [
      'article h1',
      'h1.entry-title',
      'h1.post-title',
      'h1.article-title',
      '.headline',
      'h1',
      'title'
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.textContent?.trim()) {
          return element.textContent.trim();
        }
      } catch (e) {
        continue;
      }
    }

    return document.title || null;
  }

  extractContent(document) {
    if (!document) return '';

    const selectors = [
      'article',
      '.post-content',
      '.entry-content',
      '.article-body',
      '.content',
      'main',
      '.story-body',
      '.article-content'
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.textContent?.trim()) {
          return this.cleanContent(element.textContent);
        }
      } catch (e) {
        continue;
      }
    }

    return this.cleanContent(document.body?.textContent || '');
  }

  cleanContent(text) {
    if (!text) return '';

    return text
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/More:.*$/gm, '')
      .replace(/Advertisement:/gi, '')
      .trim();
  }

  extractMeta(document) {
    if (!document) {
      return { description: null, publishedAt: null, author: null, siteName: null };
    }

    const meta = {
      description: null,
      publishedAt: null,
      author: null,
      siteName: null
    };

    try {
      const description = document.querySelector('meta[name="description"], meta[property="og:description"]');
      if (description) {
        meta.description = description.getAttribute('content');
      }

      const publishedAt = document.querySelector('meta[property="article:published_time"], time[datetime]');
      if (publishedAt) {
        meta.publishedAt = publishedAt.getAttribute('content') || publishedAt.getAttribute('datetime');
      }

      const author = document.querySelector('meta[name="author"], meta[property="article:author"]');
      if (author) {
        meta.author = author.getAttribute('content');
      }

      const siteName = document.querySelector('meta[property="og:site_name"]');
      if (siteName) {
        meta.siteName = siteName.getAttribute('content');
      }
      } catch (error) {
        this.log('warn', 'Meta extraction error', { error: error.message });
      }

    return meta;
  }

  async fetchMultiple(urls, options = {}) {
    const concurrency = options.concurrency || 3;
    const maxResults = options.maxResults || 10;
    const delayMs = options.delayMs || 500;

    if (!urls || urls.length === 0) return [];

    const validUrls = urls.filter(url => {
      const validation = URLValidator.validate(url);
      return validation.valid;
    }).slice(0, maxResults);

    const results = [];

    for (let i = 0; i < validUrls.length; i += concurrency) {
      const batch = validUrls.slice(i, i + concurrency);
      const promises = batch.map(url =>
        this.fetchArticle(url, { useCache: options.useCache !== false })
          .then(article => ({ ...article, success: true }))
          .catch(error => ({
            url,
            error: error.message,
            success: false
          }))
      );

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      if (i + concurrency < validUrls.length) {
        await this.delay(delayMs);
      }
    }

    this.log('info', 'Batch fetch completed', { requested: urls.length, success: results.filter(r => r.success).length });
    return results;
  }

  filterByDate(articles, options = {}) {
    return DateFilter.filterByAge(articles, options);
  }

  getStatus() {
    return {
      configured: true,
      lastSearch: new Date().toISOString(),
      cacheEnabled: this.cache.enabled
    };
  }
}
