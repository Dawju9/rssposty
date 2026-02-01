import axios from 'axios';
import { JSDOM } from 'jsdom';
import { URLValidator } from './utils/validation.js';
import { CacheManager } from './utils/cache.js';

export class ArticleSourceManager {
  constructor(options = {}) {
    this.sources = options.sources || ['rss', 'duckduckgo'];
    this.cache = new CacheManager({ enabled: options.cache !== false });
    this.logger = options.logger || { log: () => {}, info: () => {}, warn: () => {}, error: () => {} };

    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    this.clients = new Map();
    this.setupClients();
  }

  setupClients() {
    for (const source of this.sources) {
      this.clients.set(source, axios.create({
        timeout: 15000,
        headers: {
          'User-Agent': this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5'
        }
      }));
    }
  }

  async search(keyword, options = {}) {
    const results = [];
    const useCache = options.useCache !== false;

    for (const source of this.sources) {
      try {
        const sourceResults = await this.searchWithSource(keyword, source, useCache);
        results.push(...sourceResults);
      } catch (error) {
        this.logger.warn(`Search failed for source ${source}`, { keyword, error: error.message });
      }
    }

    return results;
  }

  async searchWithSource(keyword, source, useCache = true) {
    const cacheKey = `search_${source}_${keyword}`;

    if (useCache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ${source}:${keyword}`);
        return cached;
      }
    }

    let results = [];

    switch (source) {
      case 'rss':
        results = await this.searchRSS(keyword);
        break;
      case 'duckduckgo':
        results = await this.searchDuckDuckGo(keyword);
        break;
      case 'bing':
        results = await this.searchBing(keyword);
        break;
      case 'google':
        results = await this.searchGoogle(keyword);
        break;
      case 'startpage':
        results = await this.searchStartpage(keyword);
        break;
      case 'yahoo':
        results = await this.searchYahoo(keyword);
        break;
      case 'yandex':
        results = await this.searchYandex(keyword);
        break;
      default:
        this.logger.warn(`Unknown source: ${source}`);
    }

    if (useCache && results.length > 0) {
      await this.cache.set(cacheKey, results, 3600);
    }

    return results;
  }

  async searchDuckDuckGo(keyword, maxRetries = 3) {
    const results = [];
    const encodedKeyword = encodeURIComponent(keyword);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const client = this.clients.get('duckduckgo');
        const response = await client.get(`https://duckduckgo.com/html/?q=${encodedKeyword}&kl=us-en`);
        const dom = new JSDOM(response.data, { css: false });
        const document = dom.window.document;

        const links = document.querySelectorAll('a.result__a');

        for (const link of links) {
          const href = link.getAttribute('href');
          const title = link.textContent?.trim();

          if (href && title) {
            const actualUrl = this.extractDuckDuckGoRedirect(href);
            if (actualUrl) {
              const validation = URLValidator.validate(actualUrl);
              if (validation.valid && !actualUrl.includes('duckduckgo')) {
                results.push({
                  title,
                  url: actualUrl,
                  keyword,
                  source: 'duckduckgo',
                  publishedAt: null
                });
              }
            }
          }
          if (results.length >= 5) break;
        }

        if (results.length > 0) return results;

        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 3000));
        }
      } catch (error) {
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
        }
      }
    }

    return results;
  }

  async searchRSS(keyword) {
    const results = [];
    const client = this.clients.get('rss') || this.clients.get('duckduckgo');

    try {
      const Parser = (await import('rss-parser')).default;
      const parser = new Parser({ timeout: 10000 });
      const feed = await parser.parseURL(`https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}`);

      for (const item of feed.items.slice(0, 5)) {
        let url = item.link || '';
        if (url.includes('news.google.com/rss/articles/')) {
          const match = url.match(/\/articles\/([A-Za-z0-9_-]+)/);
          if (match) {
            url = `https://news.google.com/articles/${match[1]}`;
          }
        }

        if (url) {
          results.push({
            title: item.title || 'No title',
            url,
            description: item.contentSnippet || item.content || '',
            publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
            source: 'google-news-rss',
            keyword,
            author: item.creator || item.author
          });
        }
      }
    } catch (error) {
      this.logger.error(`RSS search failed for "${keyword}"`, { error: error.message });
    }

    return results;
  }

  async searchBing(keyword) {
    const results = [];
    const client = this.clients.get('bing');

    if (!client) {
      return results;
    }

    try {
      const encodedKeyword = encodeURIComponent(keyword);
      const response = await client.get(`https://www.bing.com/search?q=${encodedKeyword}`);
      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      const links = document.querySelectorAll('h2 a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.textContent?.trim();

        if (href && title && href.startsWith('http') && !href.includes('bing.com')) {
          const validation = URLValidator.validate(href);
          if (validation.valid) {
            results.push({
              title,
              url: href,
              keyword,
              source: 'bing',
              publishedAt: null
            });
          }
        }
        if (results.length >= 5) break;
      }
    } catch (error) {
      this.logger.error(`Bing search failed`, { keyword, error: error.message });
    }

    return results;
  }

  async searchGoogle(keyword) {
    const results = [];
    const client = this.clients.get('google');

    if (!client) {
      return results;
    }

    try {
      const encodedKeyword = encodeURIComponent(keyword);
      const response = await client.get(`https://www.google.com/search?q=${encodedKeyword}`);
      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      const links = document.querySelectorAll('div.g .r a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.textContent?.trim();

        if (href && title && href.startsWith('http') && !href.includes('google.com')) {
          const validation = URLValidator.validate(href);
          if (validation.valid) {
            results.push({
              title,
              url: href,
              keyword,
              source: 'google',
              publishedAt: null
            });
          }
        }
        if (results.length >= 5) break;
      }
    } catch (error) {
      this.logger.error(`Google search failed`, { keyword, error: error.message });
    }

    return results;
  }

  async searchStartpage(keyword) {
    const results = [];
    const client = this.clients.get('startpage') || this.clients.get('duckduckgo');

    try {
      const encodedKeyword = encodeURIComponent(keyword);
      const response = await client.get(`https://www.startpage.com/do/search?q=${encodedKeyword}&cat=web`);
      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      const links = document.querySelectorAll('a.result-link');

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.textContent?.trim();

        if (href && title && href.startsWith('http') && !href.includes('startpage.com')) {
          const validation = URLValidator.validate(href);
          if (validation.valid) {
            results.push({
              title,
              url: href,
              keyword,
              source: 'startpage',
              publishedAt: null
            });
          }
        }
        if (results.length >= 5) break;
      }
    } catch (error) {
      this.logger.error(`Startpage search failed`, { keyword, error: error.message });
    }

    return results;
  }

  async searchYahoo(keyword) {
    const results = [];
    const client = this.clients.get('yahoo') || this.clients.get('duckduckgo');

    try {
      const encodedKeyword = encodeURIComponent(keyword);
      const response = await client.get(`https://search.yahoo.com/search?p=${encodedKeyword}`);
      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      const links = document.querySelectorAll('h3.title a');

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.textContent?.trim();

        if (href && title && href.startsWith('http') && !href.includes('yahoo.com')) {
          const validation = URLValidator.validate(href);
          if (validation.valid) {
            results.push({
              title,
              url: href,
              keyword,
              source: 'yahoo',
              publishedAt: null
            });
          }
        }
        if (results.length >= 5) break;
      }
    } catch (error) {
      this.logger.error(`Yahoo search failed`, { keyword, error: error.message });
    }

    return results;
  }

  async searchYandex(keyword) {
    const results = [];
    const client = this.clients.get('yandex') || this.clients.get('duckduckgo');

    try {
      const encodedKeyword = encodeURIComponent(keyword);
      const response = await client.get(`https://yandex.com/search/?text=${encodedKeyword}`);
      const dom = new JSDOM(response.data);
      const document = dom.window.document;

      const links = document.querySelectorAll('a.organic__url');

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.textContent?.trim();

        if (href && title && href.startsWith('http') && !href.includes('yandex.com')) {
          const validation = URLValidator.validate(href);
          if (validation.valid) {
            results.push({
              title,
              url: href,
              keyword,
              source: 'yandex',
              publishedAt: null
            });
          }
        }
        if (results.length >= 5) break;
      }
    } catch (error) {
      this.logger.error(`Yandex search failed`, { keyword, error: error.message });
    }

    return results;
  }

  extractDuckDuckGoRedirect(url) {
    if (!url) return null;
    try {
      if (url.includes('duckduckgo.com/l/?')) {
        const urlMatch = url.match(/u=([^&]+)/);
        if (urlMatch) {
          return decodeURIComponent(urlMatch[1]);
        }
      }
      if (url.startsWith('/')) return null;
      return url;
    } catch (error) {
      return url;
    }
  }

  async fetchContent(url) {
    const cacheKey = `content_${url}`;

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    for (const [source, client] of this.clients) {
      try {
        const response = await client.get(url, { timeout: 15000 });
        const dom = new JSDOM(response.data, { css: false });
        const document = dom.window.document;

        const title = this.extractTitle(document);
        const content = this.extractContent(document);
        const meta = this.extractMeta(document);

        const article = {
          url,
          title: String(title || 'No title').substring(0, 500),
          content: String(content || '').substring(0, 50000),
          excerpt: String(meta.description || content || '').substring(0, 500),
          publishedAt: meta.publishedAt || new Date().toISOString(),
          author: meta.author,
          siteName: meta.siteName,
          fetchedAt: new Date().toISOString(),
          source: source
        };

        await this.cache.set(cacheKey, article, 3600);
        return article;
      } catch (error) {
        this.logger.warn(`Failed to fetch with ${source}`, { url, error: error.message });
        continue;
      }
    }

    throw new Error(`Failed to fetch article from any source`);
  }

  extractTitle(document) {
    if (!document) return null;

    const selectors = [
      'article h1', 'h1.entry-title', 'h1.post-title', 'h1',
      'meta[property="og:title"]', 'title'
    ];

    for (const selector of selectors) {
      try {
        if (selector.startsWith('meta')) {
          const element = document.querySelector(selector);
          if (element && element.getAttribute('content')?.trim()) {
            return element.getAttribute('content').trim();
          }
        } else {
          const element = document.querySelector(selector);
          if (element && element.textContent?.trim()) {
            return element.textContent.trim();
          }
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
      'article', '[role="main"]', '.post-content', '.entry-content',
      '.article-body', '.content', 'main', '.article-content', '.article'
    ];

    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && element.textContent?.trim() && element.textContent.length > 100) {
          return this.cleanContent(element.textContent);
        }
      } catch (e) {
        continue;
      }
    }

    const paragraphs = document.querySelectorAll('p');
    let paragraphText = '';
    for (const p of paragraphs) {
      const text = p.textContent?.trim();
      if (text && text.length > 50) {
        paragraphText += text + '\n\n';
      }
    }

    if (paragraphText.length > 100) {
      return this.cleanContent(paragraphText);
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
    if (!document) return { description: null, publishedAt: null, author: null, siteName: null };

    const meta = {};

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
      this.logger.warn('Meta extraction error', { error: error.message });
    }

    return meta;
  }

  async fetchMultiple(urls, options = {}) {
    const concurrency = options.concurrency || 3;
    const results = [];

    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const promises = batch.map(url =>
        this.fetchContent(url)
          .then(content => ({ url, ...content, success: true }))
          .catch(error => ({ url, error: error.message, success: false }))
      );

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      if (i + concurrency < urls.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return results;
  }
}

export default ArticleSourceManager;
