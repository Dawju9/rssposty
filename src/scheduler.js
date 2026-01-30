import { RCAgent } from './rc-agent.js';
import { ArticleDatabase } from './database.js';
import { Logger } from './utils/cache.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ArticleScheduler {
  constructor(options = {}) {
    this.configPath = options.configPath || null;
    this.intervalMinutes = options.intervalMinutes || 15;
    this.maxArticles = options.maxArticles || 10;
    this.enabled = options.enabled !== false;
    this.dryRun = options.dryRun || false;

    this.logger = new Logger({ level: 'info', fileEnabled: true });
    this.agent = null;
    this.db = null;
    this.intervalId = null;
    this.isRunning = false;
    this.stats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      totalArticles: 0,
      publishedArticles: 0,
      lastRun: null,
      lastSuccess: null
    };
  }

  async initialize() {
    this.agent = new RCAgent({
      configPath: this.configPath,
      cache: true,
      logLevel: this.dryRun ? 'debug' : 'info'
    });

    await this.agent.initialize();

    if (this.agent.config.database?.enabled) {
      this.db = new ArticleDatabase({
        enabled: true,
        path: this.agent.config.database.path
      });
      this.db.initialize();
    }

    this.logger.info('Scheduler initialized', {
      intervalMinutes: this.intervalMinutes,
      maxArticles: this.maxArticles,
      enabled: this.enabled,
      database: !!this.db
    });
  }

  async start() {
    if (!this.enabled) {
      this.logger.warn('Scheduler is disabled');
      return;
    }

    if (this.intervalId) {
      this.logger.warn('Scheduler already running');
      return;
    }

    this.logger.info('Starting scheduler', {
      intervalMinutes: this.intervalMinutes,
      maxArticles: this.maxArticles
    });

    await this.runOnce();

    this.intervalId = setInterval(async () => {
      await this.runOnce();
    }, this.intervalMinutes * 60 * 1000);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('Scheduler stopped');
    }

    if (this.db) {
      this.db.close();
    }
  }

  async runOnce() {
    if (this.isRunning) {
      this.logger.warn('Previous run still in progress, skipping');
      return;
    }

    this.isRunning = true;
    this.stats.totalRuns++;
    this.stats.lastRun = new Date().toISOString();

    const runStart = Date.now();

    try {
      this.logger.info('=== Scheduler Run Started ===', {
        runNumber: this.stats.totalRuns,
        timestamp: this.stats.lastRun
      });

      const keywords = this.agent.configManager.getKeywords();
      if (keywords.length === 0) {
        throw new Error('No keywords configured');
      }

      console.log('\n=== Scheduler Run ===');
      console.log(`Keywords: ${keywords.join(', ')}`);
      console.log(`Fetching ${this.maxArticles} articles...\n`);

      await this.agent.fetch({ keywords });
      console.log(`Found ${this.agent.articles.length} articles`);

      if (this.agent.articles.length === 0) {
        console.log('No articles found.');
        return;
      }

      const articlesToProcess = this.agent.articles.slice(0, this.maxArticles);

      console.log(`Fetching full content for ${articlesToProcess.length} articles...`);
      const urls = articlesToProcess.map(a => a.url);
      await this.agent.fetchArticleContent({ urls, maxResults: this.maxArticles });

      const contentFetched = this.agent.articles.filter(a => a.content && a.content.length > 50).length;
      console.log(`Content fetched: ${contentFetched}/${articlesToProcess.length}`);

      if (this.dryRun) {
        console.log('\n[DRY RUN - No articles published]');
        this.agent.articles.slice(0, 5).forEach((a, i) => {
          console.log(`  ${i + 1}. ${a.title?.substring(50)}...`);
        });
      } else {
        console.log('\nPublishing articles...');
        const { summary } = await this.agent.publish({ articles: this.agent.articles });
        console.log(`Published: ${summary.published}, Failed: ${summary.failed}, Skipped: ${summary.skipped}`);

        this.stats.publishedArticles += summary.published;
      }

      this.stats.successfulRuns++;
      this.stats.lastSuccess = new Date().toISOString();
      this.stats.totalArticles += contentFetched;

      const duration = Math.round((Date.now() - runStart) / 1000);
      this.logger.info('=== Scheduler Run Completed ===', {
        duration: `${duration}s`,
        articlesFetched: this.agent.articles.length,
        contentFetched,
        totalArticles: this.stats.totalArticles
      });

      console.log(`\nCompleted in ${duration}s`);
      console.log(`Next run in ${this.intervalMinutes} minutes\n`);

    } catch (error) {
      this.stats.failedRuns++;
      this.logger.error('Scheduler run failed', {
        error: error.message,
        runNumber: this.stats.totalRuns
      });
      console.error(`Error: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  getStats() {
    return {
      enabled: this.enabled,
      running: !!this.intervalId,
      intervalMinutes: this.intervalMinutes,
      maxArticles: this.maxArticles,
      dryRun: this.dryRun,
      stats: this.stats,
      uptime: this.intervalId ? Math.round((Date.now() - (this.stats.lastRun ? new Date(this.stats.lastRun).getTime() : Date.now())) / 1000) : 0
    };
  }

  async runContinuous() {
    await this.initialize();

    console.log('\n=== RC Posty Scheduler v2.0 ===\n');
    console.log(`Interval: every ${this.intervalMinutes} minutes`);
    console.log(`Max articles: ${this.maxArticles}`);
    console.log(`Dry run: ${this.dryRun ? 'Yes' : 'No'}`);
    console.log(`Database: ${this.db ? 'enabled' : 'disabled'}`);
    console.log(`Keywords: ${this.agent.configManager.getKeywords().join(', ')}`);
    console.log('\nPress Ctrl+C to stop\n');

    await this.start();

    process.on('SIGINT', async () => {
      console.log('\n\n=== Stopping Scheduler ===\n');
      await this.stop();
      console.log('Stats:', JSON.stringify(this.getStats().stats, null, 2));
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n\n=== Stopping Scheduler ===\n');
      await this.stop();
      process.exit(0);
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const intervalMinutes = parseInt(args.find(a => a.startsWith('--interval='))?.split('=')[1] || '15');
  const maxArticles = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '10');
  const dryRun = args.includes('--dry-run');
  const configPath = args.find(a => a.startsWith('--config='))?.split('=')[1] || null;

  const scheduler = new ArticleScheduler({
    configPath,
    intervalMinutes,
    maxArticles,
    dryRun,
    enabled: true
  });

  await scheduler.runContinuous();
}

if (process.argv[1] === __filename) {
  main().catch(console.error);
}
