import { RateLimiter } from './utils/validation.js';

export class WordPressManager {
  constructor(options = {}) {
    this.url = options.url;
    this.auth = options.auth;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 5000;
    this.categories = options.categories || [];

    this.rateLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60000 });
  }

  async publish(article) {
    if (!this.url || !this.auth?.username || !this.auth?.password) {
      throw new Error('WordPress not configured');
    }

    const auth = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      try {
        await this.rateLimiter.acquire('wordpress');

        const response = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
          },
          body: JSON.stringify({
            title: article.title?.substring(0, 200) || 'No title',
            content: article.content || article.excerpt || '',
            status: 'publish',
            categories: this.categories.map(c => ({ name: c }))
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;

          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.message || errorJson.code || errorMessage;
          } catch {
            errorMessage = errorText.substring(0, 200) || errorMessage;
          }

          if (response.status === 401) {
            throw new Error(`Authentication failed: ${errorMessage}. Check your Application Password.`);
          }

          if (attempt < this.retryAttempts - 1) {
            await this.delay(this.retryDelay * (attempt + 1));
            continue;
          }

          throw new Error(errorMessage);
        }

        const result = await response.json();
        return {
          success: true,
          postId: result.id,
          link: result.link,
          title: result.title?.rendered || article.title
        };
      } catch (error) {
        if (attempt < this.retryAttempts - 1) {
          await this.delay(this.retryDelay * Math.pow(2, attempt));
        } else {
          throw error;
        }
      }
    }
  }

  async publishMultiple(articles) {
    const results = [];
    let published = 0;
    let failed = 0;
    let skipped = 0;

    for (const article of articles) {
      if (!article.content || article.content.length < 50) {
        skipped++;
        results.push({
          url: article.url,
          title: article.title,
          status: 'skipped',
          reason: 'content_too_short'
        });
        continue;
      }

      try {
        const result = await this.publish(article);
        published++;
        results.push({
          url: article.url,
          postId: result.postId,
          link: result.link,
          title: result.title,
          status: 'published'
        });
      } catch (error) {
        failed++;
        results.push({
          url: article.url,
          title: article.title,
          status: 'failed',
          error: error.message
        });
      }
    }

    return { results, summary: { published, failed, skipped, total: articles.length } };
  }

  async testConnection() {
    if (!this.url || !this.auth?.username || !this.auth?.password) {
      return { success: false, error: 'Not configured' };
    }

    try {
      const auth = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
      const response = await fetch(`${this.url}?per_page=1`, {
        headers: { 'Authorization': `Basic ${auth}` }
      });

      if (response.ok) {
        return { success: true, status: response.status, message: 'Connection successful' };
      } else if (response.status === 401) {
        return { success: false, status: 401, error: 'Authentication failed. Check Application Password.' };
      } else {
        return { success: false, status: response.status, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getCategories() {
    if (!this.url || !this.auth) return [];

    try {
      const auth = Buffer.from(`${this.auth.username}:${this.auth.password}`).toString('base64');
      const response = await fetch(`${this.url}/categories?per_page=100`, {
        headers: { 'Authorization': `Basic ${auth}` }
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Failed to get categories:', error.message);
    }

    return [];
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default WordPressManager;
