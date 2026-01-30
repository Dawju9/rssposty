export class URLValidator {
  static blockedDomains = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    'internal.network',
    '169.254.169.254',
    'metadata.google.internal'
  ];

  static blockedPatterns = [
    /:\/\/192\.168\./,
    /:\/\/10\./,
    /:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /file:\/\//,
    /javascript:/,
    /data:/,
    /about:/
  ];

  static validate(url, allowedDomains = []) {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL is required' };
    }

    try {
      const parsed = new URL(url);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, error: 'Only HTTP/HTTPS protocols allowed' };
      }

      const hostname = parsed.hostname.toLowerCase();

      if (this.blockedDomains.includes(hostname)) {
        return { valid: false, error: `Blocked domain: ${hostname}` };
      }

      for (const pattern of this.blockedPatterns) {
        if (pattern.test(url)) {
          return { valid: false, error: 'URL matches blocked pattern' };
        }
      }

      if (allowedDomains.length > 0 && !allowedDomains.some(d => hostname.includes(d))) {
        return { valid: false, error: 'Domain not in allowed list' };
      }

      return { valid: true, hostname, protocol: parsed.protocol };
    } catch (error) {
      return { valid: false, error: `Invalid URL format: ${error.message}` };
    }
  }

  static sanitize(url) {
    const validation = this.validate(url);
    if (!validation.valid) {
      return null;
    }
    return url.trim();
  }
}

export class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 10;
    this.windowMs = options.windowMs || 60000;
    this.requests = new Map();
  }

  async acquire(key = 'default') {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const timestamps = this.requests.get(key).filter(t => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldest = Math.min(...timestamps);
      const waitTime = oldest + this.windowMs - now;

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.requests.set(key, [...timestamps, now]);
    return true;
  }

  reset(key) {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }
}

export class ArticleDeduplicator {
  constructor(options = {}) {
    this.hashSet = new Set();
    this.exactMatch = options.exactMatch || false;
  }

  hash(article) {
    if (this.exactMatch) {
      return article.url;
    }

    const normalized = [
      article.title?.toLowerCase().replace(/[^a-z0-9]/g, ''),
      article.url?.toLowerCase()
    ].join(':');

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  isDuplicate(article) {
    const hash = this.hash(article);
    if (this.hashSet.has(hash)) {
      return true;
    }
    this.hashSet.add(hash);
    return false;
  }

  filter(articles) {
    return articles.filter(article => !this.isDuplicate(article));
  }

  reset() {
    this.hashSet.clear();
  }
}

export class DateFilter {
  static filterByAge(articles, options = {}) {
    const maxAge = options.maxAge || 7 * 24 * 60 * 60 * 1000;
    const maxArticles = options.maxArticles || 50;
    const now = Date.now();

    return articles
      .filter(article => {
        if (!article.publishedAt) return true;
        const age = now - new Date(article.publishedAt).getTime();
        return age <= maxAge;
      })
      .sort((a, b) => {
        const dateA = new Date(a.publishedAt || 0).getTime();
        const dateB = new Date(b.publishedAt || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, maxArticles);
  }

  static isNewerThan(dateString, days = 7) {
    if (!dateString) return true;
    const date = new Date(dateString);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return date > cutoff;
  }
}
