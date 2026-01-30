import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ArticleDatabase {
  constructor(options = {}) {
    this.dbPath = options.path || path.join(__dirname, '../../data/articles.db');
    this.enabled = options.enabled !== false;
    this.db = null;
  }

  initialize() {
    if (!this.enabled) return;

    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    this.createTables();
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        title TEXT,
        content TEXT,
        excerpt TEXT,
        source TEXT,
        keyword TEXT,
        status TEXT DEFAULT 'new',
        published_at TEXT,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        published_to_wp INTEGER DEFAULT 0,
        wp_post_id INTEGER,
        error TEXT,
        retry_count INTEGER DEFAULT 0,
        content_length INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT UNIQUE,
        enabled INTEGER DEFAULT 1,
        last_search TEXT,
        article_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT DEFAULT CURRENT_DATE,
        fetched INTEGER DEFAULT 0,
        published INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        errors TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
      CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
      CREATE INDEX IF NOT EXISTS idx_articles_keyword ON articles(keyword);
      CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(fetched_at);
    `);
  }

  async saveArticle(article) {
    if (!this.enabled || !this.db) return null;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO articles (url, title, content, excerpt, source, keyword, status, content_length)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      article.url,
      article.title?.substring(0, 500),
      article.content?.substring(0, 50000) || '',
      article.excerpt?.substring(0, 1000) || '',
      article.source,
      article.keyword || null,
      article.content?.length > 100 ? 'fetched' : 'empty',
      article.content?.length || 0
    );

    return result.lastInsertRowid;
  }

  async getArticles(options = {}) {
    if (!this.enabled || !this.db) return [];

    const { status, keyword, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM articles WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (keyword) {
      query += ' AND keyword = ?';
      params.push(keyword);
    }

    query += ' ORDER BY fetched_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
  }

  async getArticleByUrl(url) {
    if (!this.enabled || !this.db) return null;

    const stmt = this.db.prepare('SELECT * FROM articles WHERE url = ?');
    return stmt.get(url);
  }

  async updateArticleStatus(url, updates) {
    if (!this.enabled || !this.db) return;

    const fields = Object.keys(updates).filter(k => k !== 'url');
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]).concat(url);

    const stmt = this.db.prepare(`UPDATE articles SET ${setClause} WHERE url = ?`);
    stmt.run(...values);
  }

  async markAsPublished(url, wpPostId) {
    await this.updateArticleStatus(url, {
      published_to_wp: 1,
      wp_post_id: wpPostId,
      status: 'published',
      published_at: new Date().toISOString()
    });
  }

  async markAsFailed(url, error) {
    await this.updateArticleStatus(url, {
      status: 'failed',
      error: error.substring(0, 500),
      retry_count: this.db.prepare('SELECT retry_count + 1 FROM articles WHERE url = ?').get(url)?.retry_count + 1 || 1
    });
  }

  async getStats() {
    if (!this.enabled || !this.db) return null;

    const total = this.db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
    const fetched = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'fetched'").get().count;
    const published = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE published_to_wp = 1").get().count;
    const failed = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'failed'").get().count;
    const empty = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'empty'").get().count;

    return {
      total,
      fetched,
      published,
      failed,
      empty,
      success_rate: total > 0 ? Math.round((fetched / total) * 100) : 0
    };
  }

  async getDailyStats(date = null) {
    if (!this.enabled || !this.db) return null;

    const targetDate = date || new Date().toISOString().split('T')[0];
    return this.db.prepare('SELECT * FROM stats WHERE date = ?').get(targetDate);
  }

  async recordDailyStats(stats) {
    if (!this.enabled || !this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO stats (date, fetched, published, failed, errors)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      new Date().toISOString().split('T')[0],
      stats.fetched || 0,
      stats.published || 0,
      stats.failed || 0,
      JSON.stringify(stats.errors || [])
    );
  }

  async cleanup(maxAgeDays = 30) {
    if (!this.enabled || !this.db) return;

    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare("DELETE FROM articles WHERE fetched_at < ?").run(cutoff);
    return result.changes;
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

export default ArticleDatabase;
