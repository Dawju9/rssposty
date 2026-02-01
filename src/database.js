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
        article_number INTEGER,
        retry_count INTEGER DEFAULT 0,
        url TEXT,
        title TEXT,
        content_raw TEXT,
        content_processed TEXT,
        content_ready TEXT,
        source TEXT,
        keyword TEXT,
        keyword_score INTEGER DEFAULT 0,
        category TEXT DEFAULT 'general',
        status TEXT DEFAULT 'raw',
        stage TEXT DEFAULT 'none',
        error TEXT,
        last_error_at TEXT,
        published_at TEXT,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT,
        ready_at TEXT,
        wp_post_id INTEGER,
        content_length INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS published_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        article_number INTEGER,
        original_url TEXT,
        title TEXT,
        content_ready TEXT,
        keyword TEXT,
        wp_post_id INTEGER,
        published_at TEXT,
        archived_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      CREATE INDEX IF NOT EXISTS idx_articles_number ON articles(article_number);
      CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
      CREATE INDEX IF NOT EXISTS idx_articles_stage ON articles(stage);
      CREATE INDEX IF NOT EXISTS idx_articles_keyword ON articles(keyword);
      CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(fetched_at);
      CREATE INDEX IF NOT EXISTS idx_articles_error ON articles(error);
      CREATE INDEX IF NOT EXISTS idx_published_wp ON published_articles(wp_post_id);
      CREATE INDEX IF NOT EXISTS idx_published_date ON published_articles(published_at);
    `);
  }

  async saveArticle(article) {
    if (!this.enabled || !this.db) return null;

    const articleNumber = await this.getNextArticleNumber();

    const stmt = this.db.prepare(`
      INSERT INTO articles (
        article_number, url, title, content_raw, source, keyword, status, stage, fetched_at, content_length
      ) VALUES (?, ?, ?, ?, ?, ?, 'raw', 'fetched', CURRENT_TIMESTAMP, ?)
    `);

    const result = stmt.run(
      articleNumber,
      article.url,
      article.title?.substring(0, 500),
      article.content?.substring(0, 50000) || '',
      article.source,
      article.keyword || null,
      article.content?.length || 0
    );

    return { id: result.lastInsertRowid, articleNumber };
  }

  async saveGeneratedArticle(articleData) {
    if (!this.enabled || !this.db) return null;

    const articleNumber = await this.getNextArticleNumber();

    const stmt = this.db.prepare(`
      INSERT INTO articles (
        article_number, title, content_processed, source, keyword, status, stage, processed_at
      ) VALUES (?, ?, ?, ?, ?, 'processed', 'ai_processed', CURRENT_TIMESTAMP)
    `);

    const result = stmt.run(
      articleNumber,
      articleData.title?.substring(0, 500),
      articleData.content?.substring(0, 50000),
      articleData.source || 'generated',
      articleData.keyword || null
    );

    return { id: result.lastInsertRowid, articleNumber };
  }

  async getNextArticleNumber() {
    if (!this.enabled || !this.db) return 1;

    const result = this.db.prepare(
      'SELECT MAX(article_number) as max FROM articles WHERE article_number IS NOT NULL'
    ).get();

    return (result?.max || 0) + 1;
  }

  async getArticleByNumber(articleNumber) {
    if (!this.enabled || !this.db) return null;

    const stmt = this.db.prepare('SELECT * FROM articles WHERE article_number = ?');
    return stmt.get(articleNumber);
  }

  async getArticlesByStatus(status, options = {}) {
    if (!this.enabled || !this.db) return [];

    const { limit = 100, offset = 0 } = options;

    const stmt = this.db.prepare(`
      SELECT * FROM articles WHERE status = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?
    `);

    return stmt.all(status, limit, offset);
  }

  async getArticlesByStage(stage, options = {}) {
    if (!this.enabled || !this.db) return [];

    const { limit = 100, offset = 0 } = options;

    const stmt = this.db.prepare(`
      SELECT * FROM articles WHERE stage = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?
    `);

    return stmt.all(stage, limit, offset);
  }

  async getArticlesWithErrors(options = {}) {
    if (!this.enabled || !this.db) return [];

    const { limit = 100, offset = 0 } = options;

    const stmt = this.db.prepare(`
      SELECT * FROM articles WHERE error IS NOT NULL AND retry_count < 3
      ORDER BY last_error_at DESC LIMIT ? OFFSET ?
    `);

    return stmt.all(limit, offset);
  }

  async updateArticle(id, updates) {
    if (!this.enabled || !this.db) return;

    const allowedFields = [
      'title', 'content_raw', 'content_processed', 'content_ready',
      'status', 'stage', 'error', 'last_error_at', 'retry_count',
      'processed_at', 'ready_at', 'published_at', 'wp_post_id'
    ];

    const fields = Object.keys(updates).filter(k => allowedFields.includes(k));
    if (fields.length === 0) return;

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]).concat(id);

    const stmt = this.db.prepare(`UPDATE articles SET ${setClause} WHERE id = ?`);
    stmt.run(...values);
  }

  async getStatsByStatus() {
    if (!this.enabled || !this.db) return null;

    const raw = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'raw'").get().count;
    const processed = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'processed'").get().count;
    const ready = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'ready'").get().count;
    const published = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'published'").get().count;
    const errors = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE error IS NOT NULL AND retry_count < 3").get().count;

    return { raw, processed, ready, published, errors };
  }

  async getStats() {
    if (!this.enabled || !this.db) return null;

    const total = this.db.prepare('SELECT COUNT(*) as count FROM articles').get().count;
    const fetched = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status IN ('raw', 'processed', 'ready')").get().count;
    const published = this.db.prepare("SELECT COUNT(*) as count FROM articles WHERE status = 'published'").get().count;
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

  async getPublishedCount(days = 7) {
    if (!this.enabled || !this.db) return 0;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(
      "SELECT COUNT(*) as count FROM articles WHERE status = 'published' AND published_at >= ?"
    ).get(cutoff);

    return result?.count || 0;
  }

  async getPublishedArchiveCount() {
    if (!this.enabled || !this.db) return 0;

    const result = this.db.prepare('SELECT COUNT(*) as count FROM published_articles').get();
    return result?.count || 0;
  }

  async archivePublishedArticle(article) {
    if (!this.enabled || !this.db) return null;

    const stmt = this.db.prepare(`
      INSERT INTO published_articles (
        article_number, original_url, title, content_ready, keyword, wp_post_id, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      article.article_number,
      article.url,
      article.title,
      article.content_ready,
      article.keyword,
      article.wp_post_id,
      article.published_at
    );
  }

  async cleanupOldArticles(maxAgeDays = 4) {
    if (!this.enabled || !this.db) return { deleted: 0 };

    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(
      "DELETE FROM articles WHERE fetched_at < ? AND status IN ('raw', 'processed', 'ready')"
    ).run(cutoff);

    return { deleted: result.changes };
  }

  async deleteOldestByStatus(status, count) {
    if (!this.enabled || !this.db) return { deleted: 0 };

    const result = this.db.prepare(`
      DELETE FROM articles WHERE id IN (
        SELECT id FROM articles WHERE status = ? ORDER BY fetched_at ASC LIMIT ?
      )
    `).run(status, count);

    return { deleted: result.changes };
  }

  async deleteByAge(status, maxAgeDays) {
    if (!this.enabled || !this.db) return { deleted: 0 };

    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(
      "DELETE FROM articles WHERE status = ? AND fetched_at < ?"
    ).run(status, cutoff);

    return { deleted: result.changes };
  }

  async archiveOldPublished(archiveAfterDays = 90) {
    if (!this.enabled || !this.db) return { archived: 0 };

    const cutoff = new Date(Date.now() - archiveAfterDays * 24 * 60 * 60 * 1000).toISOString();

    const oldPublished = this.db.prepare(`
      SELECT * FROM articles WHERE status = 'published' AND published_at < ?
    `).all(cutoff);

    let archived = 0;
    for (const article of oldPublished) {
      await this.archivePublishedArticle(article);
      this.db.prepare('DELETE FROM articles WHERE id = ?').run(article.id);
      archived++;
    }

    return { archived };
  }

  async getArticleNumbersByStatus(status) {
    if (!this.enabled || !this.db) return [];

    const results = this.db.prepare(`
      SELECT article_number FROM articles WHERE status = ? ORDER BY article_number
    `).all(status);

    return results.map(r => r.article_number);
  }

  async getOldestArticleByStatus(status) {
    if (!this.enabled || !this.db) return null;

    return this.db.prepare(`
      SELECT * FROM articles WHERE status = ? ORDER BY fetched_at ASC LIMIT 1
    `).get(status);
  }

  async getArticlesWithContentRaw(limit = 10) {
    if (!this.enabled || !this.db) return [];

    return this.db.prepare(`
      SELECT * FROM articles
      WHERE status = 'raw' AND stage = 'content_extracted' AND content_raw IS NOT NULL AND content_raw != ''
      ORDER BY fetched_at ASC LIMIT ?
    `).all(limit);
  }

  async getArticlesReadyToPublish(limit = 10) {
    if (!this.enabled || !this.db) return [];

    return this.db.prepare(`
      SELECT * FROM articles WHERE status = 'ready' ORDER BY ready_at ASC LIMIT ?
    `).all(limit);
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
