import { ArticleDatabase } from './database.js';
import { RCAgent } from './rc-agent.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Monitor {
  constructor(options = {}) {
    this.statsFile = options.statsFile || path.join(__dirname, '../data/stats.json');
    this.logFile = options.logFile || path.join(__dirname, '../logs/monitor.log');
    this.checkInterval = options.checkInterval || 60000;
    this.db = new ArticleDatabase({ enabled: true, path: path.join(__dirname, '../data/articles.db') });
    this.running = false;
    this.intervalId = null;
  }

  initialize() {
    this.db.initialize();

    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const statsDir = path.dirname(this.statsFile);
    if (!fs.existsSync(statsDir)) {
      fs.mkdirSync(statsDir, { recursive: true });
    }
  }

  async checkHealth() {
    const health = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      checks: {}
    };

    try {
      const dbStats = await this.db.getStats();
      health.checks.database = {
        status: 'ok',
        total_articles: dbStats?.total || 0,
        fetched: dbStats?.fetched || 0,
        published: dbStats?.published || 0,
        failed: dbStats?.failed || 0,
        success_rate: dbStats?.success_rate || 0
      };
    } catch (error) {
      health.checks.database = { status: 'error', error: error.message };
      health.status = 'degraded';
    }

    try {
      const agent = new RCAgent();
      await agent.initialize();

      health.checks.ollama = {
        status: agent.ollamaClient ? 'connected' : 'disconnected',
        model: agent.config?.ollama?.model || 'unknown'
      };

      try {
        const wpConfig = agent.configManager.getWordPressConfig();
        if (wpConfig) {
          const wpTest = await agent.wpManager?.testConnection();
          health.checks.wordpress = wpTest || { status: 'unknown' };
        } else {
          health.checks.wordpress = { status: 'not_configured' };
        }
      } catch (wpError) {
        health.checks.wordpress = { status: 'error', error: wpError.message };
        health.status = 'degraded';
      }
    } catch (error) {
      health.checks.ollama = { status: 'error', error: error.message };
      health.status = 'degraded';
    }

    try {
      const cacheDir = path.join(__dirname, '../cache');
      const cacheFiles = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).length : 0;
      health.checks.cache = {
        status: 'ok',
        files: cacheFiles
      };
    } catch (error) {
      health.checks.cache = { status: 'error', error: error.message };
    }

    return health;
  }

  async getStats() {
    const dbStats = await this.db.getStats();
    const todayStats = await this.db.getDailyStats();

    return {
      timestamp: new Date().toISOString(),
      database: dbStats,
      today: todayStats,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      node_version: process.version
    };
  }

  async saveStats(stats) {
    fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    fs.appendFileSync(this.logFile, logLine);
    console.log(logLine);
  }

  async runOnce() {
    this.initialize();
    this.log('Running health check...');

    const health = await this.checkHealth();
    const stats = await this.getStats();

    console.log('\n=== MONITOR REPORT ===\n');
    console.log(`Status: ${health.status.toUpperCase()}`);
    console.log(`Timestamp: ${health.timestamp}\n`);

    console.log('Database:');
    console.log(`  Total Articles: ${health.checks.database?.total_articles || 0}`);
    console.log(`  Fetched: ${health.checks.database?.fetched || 0}`);
    console.log(`  Published: ${health.checks.database?.published || 0}`);
    console.log(`  Success Rate: ${health.checks.database?.success_rate || 0}%\n`);

    console.log('Ollama:');
    console.log(`  Status: ${health.checks.ollama?.status}`);
    console.log(`  Model: ${health.checks.ollama?.model}\n`);

    console.log('WordPress:');
    console.log(`  Status: ${health.checks.wordpress?.status}`);
    console.log(`  Message: ${health.checks.wordpress?.message || health.checks.wordpress?.error || 'N/A'}\n`);

    console.log('System:');
    console.log(`  Uptime: ${Math.floor(stats.uptime / 60)}m`);
    console.log(`  Memory: ${Math.round(stats.memory.heapUsed / 1024 / 1024)}MB`);

    await this.saveStats(stats);
    this.log(`Health check completed: ${health.status}`);

    return health;
  }

  async start() {
    this.initialize();
    this.running = true;

    this.log('Starting monitor...');
    await this.runOnce();

    this.intervalId = setInterval(async () => {
      if (this.running) {
        await this.runOnce();
      }
    }, this.checkInterval);

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.db.close();
    this.log('Monitor stopped');
    process.exit(0);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const interval = parseInt(args.find(a => a.startsWith('--interval='))?.split('=')[1] || '60');

  const monitor = new Monitor({ checkInterval: interval * 1000 });

  if (args.includes('--once')) {
    await monitor.runOnce();
  } else {
    await monitor.start();
  }
}

if (process.argv[1] === __filename) {
  main().catch(console.error);
}
