import RSSParser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CustomFeedFetcher {
  constructor(options = {}) {
    this.parser = new RSSParser({
      timeout: options.timeout || 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    this.keywordsPath = options.keywordsPath || path.join(process.cwd(), 'data/keywords.json');
    this.keywords = this.loadKeywords();
    this.logger = options.logger || {
      log: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {}
    };
  }

  loadKeywords() {
    try {
      if (fs.existsSync(this.keywordsPath)) {
        const data = JSON.parse(fs.readFileSync(this.keywordsPath, 'utf8'));
        return data.keywords.filter(k => k.enabled).map(k => k.word.toLowerCase());
      }
    } catch (error) {
      this.logger.warn('Failed to load keywords', { error: error.message });
    }
    return [];
  }

  reloadKeywords() {
    this.keywords = this.loadKeywords();
    this.logger.info('Keywords reloaded', { count: this.keywords.length });
  }

  matchKeywords(text) {
    if (!text) return { matched: [], score: 0 };

    const textLower = text.toLowerCase();
    const matched = [];
    let score = 0;

    for (const keyword of this.keywords) {
      if (textLower.includes(keyword)) {
        matched.push(keyword);
        score += keyword.split(' ').length;
      }
    }

    return { matched, score };
  }

  async fetchFeeds(feeds, options = {}) {
    const maxItemsPerFeed = options.maxItemsPerFeed || 10;
    const minScore = options.minScore || 0;
    const maxTotalItems = options.maxTotalItems || 50;

    if (!feeds || feeds.length === 0) {
      this.logger.warn('No custom feeds provided');
      return { items: [], stats: { totalFeeds: 0, processed: 0, failed: 0, totalItems: 0, filtered: 0 } };
    }

    const allItems = [];
    const seenUrls = new Set();
    let feedsProcessed = 0;
    let feedsFailed = 0;
    let filteredCount = 0;

    for (const feedInfo of feeds) {
      const feedUrl = feedInfo.url || feedInfo;
      const feedName = feedInfo.name || feedUrl;

      try {
        const feed = await this.parser.parseURL(feedUrl);

        for (const item of feed.items.slice(0, maxItemsPerFeed)) {
          const itemUrl = item.link || item.id;
          if (!itemUrl || seenUrls.has(itemUrl)) continue;

          const title = item.title || '';
          const description = item.contentSnippet || item.content || '';
          const fullText = `${title} ${description}`.substring(0, 2000);

          const { matched, score } = this.matchKeywords(fullText);

          if (score < minScore && matched.length === 0) {
            filteredCount++;
            continue;
          }

          seenUrls.add(itemUrl);
          allItems.push({
            title,
            url: itemUrl,
            description: this.stripHtml(description).substring(0, 500),
            content: this.stripHtml(description),
            publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
            source: feedName,
            sourceUrl: feedUrl,
            keywords: matched.length > 0 ? matched : ['general'],
            keywordScore: score > 0 ? score : 1,
            category: this.getCategory(matched)
          });
        }
        feedsProcessed++;
      } catch (error) {
        this.logger.error(`Failed to fetch custom feed: ${feedName}`, { url: feedUrl, error: error.message });
        feedsFailed++;
      }

      if (allItems.length >= maxTotalItems) break;
    }

    const sortedItems = allItems
      .sort((a, b) => b.keywordScore - a.keywordScore)
      .slice(0, maxTotalItems);

    const result = {
      items: sortedItems,
      stats: {
        totalFeeds: feeds.length,
        processed: feedsProcessed,
        failed: feedsFailed,
        totalItems: sortedItems.length,
        filtered: filteredCount
      }
    };

    this.logger.info('Custom feeds fetch completed', result.stats);
    return result;
  }

  getCategory(matchedKeywords) {
    const categoryMap = {
      'sales': ['sprzedaż', 'selling', 'sales'],
      'soft-skills': ['kompetencje miękkie', 'soft skills', 'komunikacja'],
      'leadership': ['leadership', 'przywództwo', 'zarządzanie zespołem', 'lider'],
      'training': ['szkolenie', 'trening', 'szkolenia'],
      'coaching': ['coaching', 'coach'],
      'motivation': ['motywacja', 'motywacyjne']
    };

    for (const [category, keywords] of Object.entries(categoryMap)) {
      for (const keyword of matchedKeywords) {
        for (const mapKeyword of keywords) {
          if (keyword.includes(mapKeyword) || mapKeyword.includes(keyword)) {
            return category;
          }
        }
      }
    }
    return 'general';
  }

  stripHtml(html) {
    if (!html) return '';
    return String(html)
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async saveToDatabase(items, db) {
    if (!db || !items.length) return { saved: 0, skipped: 0 };

    let saved = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        const articleNumber = await db.getNextArticleNumber();

        await db.db.prepare(`
          INSERT INTO articles (
            article_number, url, title, content_raw, source, keyword,
            status, stage, fetched_at, keyword_score, category
          ) VALUES (?, ?, ?, ?, ?, ?, 'raw', 'fetched', CURRENT_TIMESTAMP, ?, ?)
        `).run(
          articleNumber,
          item.url,
          item.title?.substring(0, 500),
          item.content?.substring(0, 50000),
          item.source,
          item.keywords.join(', '),
          item.keywordScore,
          item.category
        );

        saved++;
      } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
          skipped++;
        } else {
          this.logger.error('Failed to save article', { url: item.url, error: error.message });
        }
      }
    }

    return { saved, skipped };
  }

  async updateKeywordsStats(items, db) {
    if (!db || !items.length) return;

    const keywordCounts = {};
    for (const item of items) {
      for (const keyword of item.keywords || []) {
        keywordCounts[keyword] = (keywordCounts[keyword] || 0) + 1;
      }
    }

    try {
      const keywordsData = JSON.parse(fs.readFileSync(this.keywordsPath, 'utf8'));

      for (const keyword of keywordsData.keywords) {
        if (keywordCounts[keyword.word]) {
          keyword.matchCount = (keyword.matchCount || 0) + keywordCounts[keyword.word];
        }
      }

      keywordsData.stats.lastFetchDate = new Date().toISOString();
      keywordsData.stats.totalMatches += items.length;

      fs.writeFileSync(this.keywordsPath, JSON.stringify(keywordsData, null, 2));
      this.logger.info('Keywords stats updated');
    } catch (error) {
      this.logger.error('Failed to update keywords stats', { error: error.message });
    }
  }
}

export default CustomFeedFetcher;
