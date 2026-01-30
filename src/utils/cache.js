import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CacheManager {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(__dirname, '../cache');
    this.maxAge = options.maxAge || 60 * 60 * 1000;
    this.enabled = options.enabled !== false;
  }

  async ensureCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.warn(`Cache dir creation failed: ${error.message}`);
      }
    }
  }

  getKey(key) {
    return key.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 100);
  }

  async get(key) {
    if (!this.enabled) return null;

    try {
      await this.ensureCacheDir();
      const filePath = path.join(this.cacheDir, this.getKey(key) + '.json');

      const stats = await fs.stat(filePath);
      if (Date.now() - stats.mtimeMs > this.maxAge) {
        await fs.unlink(filePath);
        return null;
      }

      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Cache read error: ${error.message}`);
      }
      return null;
    }
  }

  async set(key, value) {
    if (!this.enabled) return;

    try {
      await this.ensureCacheDir();
      const filePath = path.join(this.cacheDir, this.getKey(key) + '.json');
      await fs.writeFile(filePath, JSON.stringify(value, null, 2));
    } catch (error) {
      console.warn(`Cache write error: ${error.message}`);
    }
  }

  async invalidate(key) {
    try {
      const filePath = path.join(this.cacheDir, this.getKey(key) + '.json');
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore
    }
  }

  async clear() {
    try {
      await this.ensureCacheDir();
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files.map(file => fs.unlink(path.join(this.cacheDir, file)))
      );
    } catch (error) {
      console.warn(`Cache clear error: ${error.message}`);
    }
  }

  async getRSSCacheKey(keyword) {
    return `rss_${keyword}_${new Date().toISOString().split('T')[0]}`;
  }

  async getArticleCacheKey(url) {
    const hash = Buffer.from(url).toString('base64').substring(0, 32);
    return `article_${hash}`;
  }
}

export class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(__dirname, '../logs');
    this.level = options.level || 'info';
    this.fileEnabled = options.fileEnabled !== false;
    this.levels = ['debug', 'info', 'warn', 'error'];
  }

  async ensureLogDir() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        console.warn(`Log dir creation failed: ${error.message}`);
      }
    }
  }

  getLevelValue(level) {
    return this.levels.indexOf(level);
  }

  shouldLog(level) {
    return this.getLevelValue(level) >= this.getLevelValue(this.level);
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  async writeToFile(message) {
    if (!this.fileEnabled) return;

    try {
      await this.ensureLogDir();
      const today = new Date().toISOString().split('T')[0];
      const filePath = path.join(this.logDir, `${today}.log`);

      await fs.appendFile(filePath, message + '\n');
    } catch (error) {
      console.warn(`Log write error: ${error.message}`);
    }
  }

  async log(level, message, meta = {}) {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message, meta);

    switch (level) {
      case 'debug':
        if (this.shouldLog('debug')) console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }

    await this.writeToFile(formatted);
  }

  debug(message, meta) {
    return this.log('debug', message, meta);
  }

  info(message, meta) {
    return this.log('info', message, meta);
  }

  warn(message, meta) {
    return this.log('warn', message, meta);
  }

  error(message, meta) {
    return this.log('error', message, meta);
  }
}
