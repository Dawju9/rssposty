import axios from 'axios';
import RSSParser from 'rss-parser';
import { URLValidator, RateLimiter } from './utils/validation.js';
import { CacheManager } from './utils/cache.js';

export class RSSFetcher {
  constructor(options = {}) {
    this.parser = new RSSParser({
      timeout: options.timeout || 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    this.client = axios.create({
      timeout: options.timeout || 15000
    });

    this.delayMs = options.delayMs || 500;
    this.rateLimiter = new RateLimiter({
      maxRequests: options.maxRequests || 20,
      windowMs: options.windowMs || 60000
    });

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

  async fetchFeeds(feeds, options = {}) {
    const maxItemsPerFeed = options.maxItemsPerFeed || 5;
    const maxTotalItems = options.maxTotalItems || 50;

    if (!feeds || feeds.length === 0) {
      this.log('warn', 'No RSS feeds provided');
      return { items: [], stats: { totalFeeds: 0, processed: 0, failed: 0, totalItems: 0 } };
    }

    const allItems = [];
    const seenUrls = new Set();
    let feedsProcessed = 0;
    let feedsFailed = 0;

    for (const feedInfo of feeds) {
      const feedUrl = typeof feedInfo === 'string' ? feedInfo : feedInfo.url;
      const keyword = typeof feedInfo === 'object' ? feedInfo.keyword : null;

      await this.rateLimiter.acquire('rss');
      await this.delay(this.delayMs);

      try {
        const items = await this.fetchFeed(feedUrl, maxItemsPerFeed);

        for (const item of items) {
          const itemUrl = item.url;
          if (itemUrl && !seenUrls.has(itemUrl) && allItems.length < maxTotalItems) {
            seenUrls.add(itemUrl);
            if (keyword) item.keyword = keyword;
            allItems.push(item);
          }
        }
        feedsProcessed++;
      } catch (error) {
        this.log('warn', `Failed to fetch RSS feed`, { url: feedUrl, error: error.message });
        feedsFailed++;
      }
    }

    const sortedItems = allItems.sort((a, b) => {
      const dateA = new Date(a.publishedAt || 0).getTime();
      const dateB = new Date(b.publishedAt || 0).getTime();
      return dateB - dateA;
    });

    const result = {
      items: sortedItems,
      stats: {
        totalFeeds: feeds.length,
        processed: feedsProcessed,
        failed: feedsFailed,
        totalItems: sortedItems.length
      }
    };

    this.log('info', 'RSS fetch completed', result.stats);
    return result;
  }

  async fetchFeed(feedUrl, maxItems = 5) {
    if (!feedUrl) {
      throw new Error('Feed URL is required');
    }

    const validation = URLValidator.validate(feedUrl);
    if (!validation.valid) {
      throw new Error(`Invalid feed URL: ${validation.error}`);
    }

    try {
      const feed = await this.parser.parseURL(feedUrl);

      if (!feed || !feed.items) {
        throw new Error('Invalid feed structure');
      }

      return feed.items.slice(0, maxItems).map(item => ({
        title: item.title || 'No title',
        url: item.link || item.id || '',
        description: this.stripHtml(item.contentSnippet || item.content || ''),
        publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
        source: feed.title || feedUrl,
        sourceUrl: feedUrl,
        author: item.creator || item.author,
        categories: item.categories || [],
        guid: item.guid || null,
        source: 'rss'
      }));
    } catch (error) {
      this.log('error', 'Failed to parse feed', { url: feedUrl, error: error.message });
      throw new Error(`Failed to parse feed: ${error.message}`);
    }
  }

  stripHtml(html) {
    if (!html) return '';

    return String(html)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  generateKeywordFeeds(keywords, options = {}) {
    const useGoogleNews = options.googleNews !== false;
    const feeds = [];

    if (useGoogleNews) {
      for (const keyword of keywords) {
        feeds.push({
          url: `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}`,
          keyword,
          type: 'google-news'
        });
      }
    }

    return feeds;
  }

  async fetchKeywordFeeds(keywords, options = {}) {
    if (!keywords || keywords.length === 0) {
      return { items: [], stats: { totalFeeds: 0, processed: 0, failed: 0, totalItems: 0 }, feeds: [] };
    }

    const keywordFeeds = this.generateKeywordFeeds(keywords, options);
    const customFeeds = (options.customFeeds || []).map(url => ({ url, type: 'custom' }));

    const allFeeds = [...keywordFeeds, ...customFeeds];

    const result = await this.fetchFeeds(allFeeds, {
      maxItemsPerFeed: options.maxItemsPerFeed || 5,
      maxTotalItems: options.maxTotalItems || 50
    });

    return {
      ...result,
      feeds: keywordFeeds
    };
  }

  async checkFeedHealth(feeds) {
    if (!feeds || feeds.length === 0) return [];

    const results = [];

    for (const feedUrl of feeds) {
      await this.rateLimiter.acquire('health');

      try {
        const response = await this.client.head(feedUrl, { timeout: 5000 });
        results.push({
          url: feedUrl,
          status: response.status === 200 ? 'ok' : 'error',
          statusCode: response.status
        });
      } catch (error) {
        results.push({
          url: feedUrl,
          status: 'error',
          error: error.code || error.message
        });
      }
    }

    return results;
  }

  async fetchFeedDetails(feedUrl) {
    if (!feedUrl) {
      return { url: null, error: 'Feed URL is required', status: 'error' };
    }

    try {
      const feed = await this.parser.parseURL(feedUrl);
      return {
        url: feedUrl,
        title: feed.title || 'Unknown',
        description: feed.description || '',
        link: feed.link || '',
        lastUpdated: new Date().toISOString(),
        items: feed.items?.length || 0,
        status: 'ok'
      };
    } catch (error) {
      return {
        url: feedUrl,
        error: error.message,
        status: 'error'
      };
    }
  }

  getStatus() {
    return {
      configured: true,
      lastFetch: new Date().toISOString()
    };
  }
}
