import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ConfigManager {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(__dirname, '../config/default.json');
    this.config = null;
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);

      if (process.env.NODE_ENV) {
        const envConfigPath = this.configPath.replace('default', process.env.NODE_ENV);
        try {
          const envConfigData = await fs.readFile(envConfigPath, 'utf8');
          const envConfig = JSON.parse(envConfigData);
          this.config = this.mergeConfigs(this.config, envConfig);
        } catch (error) {
          // Environment config not found, continue with default
        }
      }

      this.applyEnvironmentVariables();
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  mergeConfigs(baseConfig, envConfig) {
    if (!baseConfig) baseConfig = {};
    if (!envConfig) return baseConfig;

    const merged = { ...baseConfig };

    for (const [key, value] of Object.entries(envConfig)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        merged[key] = { ...(merged[key] || {}), ...value };
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  applyEnvironmentVariables() {
    if (!this.config) return;

    const envMappings = {
      'OLLAMA_URL': 'ollama.baseUrl',
      'OLLAMA_MODEL': 'ollama.model',
      'WORDPRESS_URL': 'endpoints.wordpress.url',
      'WORDPRESS_USER': 'endpoints.wordpress.auth.username',
      'WORDPRESS_PASS': 'endpoints.wordpress.auth.password',
      'TELEGRAM_BOT_TOKEN': 'endpoints.telegram.botToken',
      'TELEGRAM_CHANNEL_ID': 'endpoints.telegram.channelId'
    };

    for (const [envVar, configPath] of Object.entries(envMappings)) {
      if (process.env[envVar]) {
        this.setNestedProperty(this.config, configPath, process.env[envVar]);
      }
    }
  }

  setNestedProperty(obj, path, value) {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
  }

  get(key) {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }
    return key ? this.config[key] : this.config;
  }

  set(key, value) {
    if (!this.config) {
      this.config = {};
    }
    this.config[key] = value;
  }

  async saveConfig() {
    if (!this.config) {
      throw new Error('No config to save');
    }

    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }

  getStatus() {
    if (!this.config) {
      return {
        status: 'not_loaded',
        message: 'Configuration not loaded',
        keywords: 0,
        rssFeeds: 0
      };
    }

    const rssConfig = this.getRSSConfig();

    return {
      status: 'loaded',
      configPath: this.configPath,
      keywords: this.config.keywords?.length || 0,
      rssFeeds: rssConfig.totalFeeds,
      ollamaConfigured: !!(this.config.ollama?.baseUrl && this.config.ollama?.model),
      wordpressConfigured: this.isWordPressConfigured(),
      telegramConfigured: this.isTelegramConfigured()
    };
  }

  validateConfig() {
    if (!this.config) {
      return { valid: false, errors: ['Config not loaded'] };
    }

    const errors = [];
    const warnings = [];

    if (!this.config.keywords || !Array.isArray(this.config.keywords) || this.config.keywords.length === 0) {
      errors.push('keywords must be a non-empty array');
    }

    if (!this.config.ollama || !this.config.ollama.baseUrl || !this.config.ollama.model) {
      warnings.push('ollama is not configured - article generation will be skipped');
    }

    if (this.config.endpoints?.wordpress) {
      const wp = this.config.endpoints.wordpress;
      if (!wp.url || !wp.auth?.username || !wp.auth?.password) {
        warnings.push('wordpress endpoint is incomplete - publishing will be skipped');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  getKeywords() {
    return this.config?.keywords || [];
  }

  getRSSConfig() {
    const feeds = this.config?.rss?.customFeeds || [];
    const keywords = this.config?.keywords || [];

    return {
      googleNews: this.config?.rss?.googleNews !== false,
      customFeeds: feeds,
      keywordFeeds: keywords.length,
      totalFeeds: feeds.length + keywords.length
    };
  }

  getSearchConfig() {
    return {
      maxResults: this.config?.search?.maxResults || 10,
      concurrency: this.config?.search?.concurrency || 3,
      delayMs: this.config?.search?.delayMs || 1000,
      maxAgeDays: this.config?.search?.maxAgeDays || 7
    };
  }

  getPublishConfig() {
    return {
      dryRun: this.config?.publish?.dryRun || false,
      skipExisting: this.config?.publish?.skipExisting || false,
      categories: this.config?.publish?.categories || []
    };
  }

  getWordPressConfig() {
    if (!this.isWordPressConfigured()) {
      return null;
    }
    return this.config.endpoints.wordpress;
  }

  isWordPressConfigured() {
    const wp = this.config?.endpoints?.wordpress;
    return !!(wp?.url && wp?.auth?.username && wp?.auth?.password);
  }

  isTelegramConfigured() {
    const tg = this.config?.endpoints?.telegram;
    return !!(tg?.botToken && tg?.channelId);
  }

  async backupConfig() {
    const backupPath = this.configPath.replace('.json', `_${Date.now()}.json.bak`);
    try {
      await fs.copyFile(this.configPath, backupPath);
      return backupPath;
    } catch (error) {
      throw new Error(`Failed to backup config: ${error.message}`);
    }
  }
}
