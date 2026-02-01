#!/usr/bin/env node

import { Command } from 'commander';
import { RCAgent } from './rc-agent.js';
import { Monitor } from './monitor.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('rcposty')
  .description('Web content fetcher and publisher for WordPress')
  .version('2.0.0')
  .configureHelp({
    subcommandTerm: (cmd) => cmd.name(),
    argumentTerm: () => ''
  });

program
  .command('status')
  .description('Show system status and configuration')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();
      const status = await agent.getStats();

      console.log('\n=== RC Posty Status ===\n');
      console.log('Configuration:');
      console.log(`  Status: ${status.config.status}`);
      console.log(`  Keywords: ${status.keywords.join(', ')}`);
      console.log(`  RSS Feeds: ${status.rss.totalFeeds} (${status.rss.googleNews ? 'Google News + ' : ''}${status.rss.customFeeds?.length || 0} custom)`);
      console.log(`  Ollama: ${status.ollama}`);
      console.log(`  WordPress: ${status.wordpress}`);
      console.log(`  Database: ${status.database ? 'enabled' : 'disabled'}`);

      console.log('\nSearch Settings:');
      console.log(`  Max Results: ${status.search.maxResults}`);
      console.log(`  Max Age: ${status.search.maxAgeDays} days`);
      console.log(`  Sources: ${status.search.sources?.join(', ') || 'default'}`);

      console.log('\nPublishing:');
      console.log(`  Dry Run: ${status.publish.dryRun ? 'Yes' : 'No'}`);
      console.log(`  Categories: ${status.publish.categories?.join(', ') || 'none'}`);

      console.log('\nData:');
      console.log(`  Articles: ${status.articlesCount}`);
      console.log(`  Cache: ${status.cache ? 'enabled' : 'disabled'}`);

      if (status.database) {
        console.log('\nDatabase Stats:');
        console.log(`  Total: ${status.database.total}`);
        console.log(`  Fetched: ${status.database.fetched}`);
        console.log(`  Published: ${status.database.published}`);
        console.log(`  Success Rate: ${status.database.success_rate}%`);
      }

      console.log(`\nUptime: ${Math.floor(status.uptime / 60)} minutes`);

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show detailed statistics')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();
      const stats = await agent.getStats();

      console.log('\n=== RC Posty Statistics ===\n');
      console.log(JSON.stringify(stats, null, 2));

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('monitor')
  .description('Run system monitor')
  .option('--interval <seconds>', 'Check interval', '60')
  .option('--once', 'Run once and exit')
  .action(async (options) => {
    try {
      const monitor = new Monitor({
        checkInterval: parseInt(options.interval) * 1000
      });

      if (options.once) {
        await monitor.runOnce();
      } else {
        await monitor.start();
      }

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('fetch')
  .description('Fetch articles from RSS and web based on keywords')
  .option('-k, --keywords <keywords>', 'Override keywords (comma-separated)')
  .option('-n, --number <n>', 'Max articles', '20')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      const keywords = options.keywords
        ? options.keywords.split(',').map(k => k.trim())
        : null;

      console.log('\n=== Fetching Articles ===\n');

      const result = await agent.fetch({ keywords });

      console.log('\n=== Results ===\n');
      console.log(`RSS Articles: ${result.rss?.items?.length || 0}`);
      console.log(`Web Articles: ${result.web.length}`);
      console.log(`Total: ${result.total}`);

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach(e => console.log(`  - ${e.source}: ${e.error}`));
      }

      if (agent.articles.length > 0) {
        console.log('\nLatest Articles:');
        agent.articles.slice(0, parseInt(options.number)).forEach((article, i) => {
          const date = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : 'unknown';
          console.log(`  ${i + 1}. ${article.title?.substring(60)}... [${article.source}] (${date})`);
        });
      }

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('fetch-full')
  .description('Fetch full content for fetched articles')
  .option('-n, --number <n>', 'Number of articles', '10')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      let articles = await agent.db.getArticlesByStatus('raw', { limit: parseInt(options.number) });

      if (articles.length === 0) {
        console.log('No raw articles. Run "fetch" first.');
        process.exit(0);
      }

      const urls = articles.map(a => a.url);

      console.log(`\nFetching full content for ${urls.length} articles...\n`);

      const fetchedArticles = await agent.fetchArticleContent({ urls });

      let i = 0;
      for (const fetched of fetchedArticles) {
        if (fetched.success) {
          const original = articles.find(a => a.url === fetched.url);
          if (original) {
            await agent.db.updateArticle(original.id, {
              content_raw: fetched.content,
              stage: 'content_extracted'
            });
          }
          i++;
          console.log(`✓ ${i}. ${fetched.title?.substring(50)}...`);
          console.log(`   ${fetched.content?.length} chars`);
        }
      }

      console.log(`\nUpdated ${fetchedArticles.filter(a => a.success).length} articles with full content`);

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('wp-test')
  .description('Test WordPress connection')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      console.log('\n=== WordPress Connection Test ===\n');

      const result = await agent.testWordPressConnection();

      if (result.success) {
        console.log(`✓ ${result.message}`);
        console.log(`  Status: ${result.status}`);
      } else {
        console.log(`✗ ${result.error || result.message}`);
        if (result.status === 401) {
          console.log('\nTroubleshooting:');
          console.log('1. Go to WordPress Admin → Users → Profile');
          console.log('2. Create an Application Password in the "Application Passwords" section');
          console.log('3. Update config/default.json with the new password');
        }
      }

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('publish')
  .description('Publish articles to WordPress')
  .option('-n, --number <n>', 'Number of articles', '10')
  .option('--dry-run', 'Show what would be published without publishing')
  .option('--no-cache', 'Skip cache')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({
        configPath: options.config,
        cache: options.cache !== false,
        logLevel: options.dryRun ? 'debug' : 'info'
      });
      await agent.initialize();

      if (agent.articles.length === 0) {
        console.log('No articles. Run "fetch" first.');
        process.exit(0);
      }

      const articles = agent.articles.slice(0, parseInt(options.number));

      console.log(`\n=== Publishing ${articles.length} Articles ===\n`);

      if (options.dryRun) {
        articles.forEach((article, i) => {
          console.log(`${i + 1}. ${article.title?.substring(60)}...`);
          console.log(`   ${article.source} | ${article.publishedAt || 'no date'}`);
        });
        console.log('\n[Dry run - no articles were published]');
        process.exit(0);
      }

      const { results, summary } = await agent.publish({ articles });

      console.log('\n=== Publishing Summary ===\n');
      console.log(`Published: ${summary.published}`);
      console.log(`Failed: ${summary.failed}`);
      console.log(`Skipped: ${summary.skipped}`);

      results.filter(r => r.status === 'published').forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.title?.substring(50)}...`);
        console.log(`     ${r.link || r.url}`);
      });

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate article using Ollama')
  .option('-k, --keywords <keywords>', 'Keywords for article')
  .option('-s, --style <style>', 'Article style', 'professional')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      const keywords = options.keywords
        ? options.keywords.split(',').map(k => k.trim())
        : null;

      console.log('\n=== Generating Article ===\n');

      const article = await agent.generateArticle(keywords, options.style);

      console.log(article);
      console.log('\n✓ Article generated');

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('cache')
  .description('Manage cache')
  .addCommand(
    program.createCommand('clear').description('Clear cache').action(async () => {
      const agent = new RCAgent();
      await agent.clearCache();
      console.log('Cache cleared');
    })
  )
  .addCommand(
    program.createCommand('status').description('Show cache status').action(async () => {
      const agent = new RCAgent();
      const status = agent.cache.getStatus();
      console.log('Cache enabled:', status.configured);
      console.log('Last operation:', status.lastFetch);
    })
  );

program
  .command('db')
  .description('Manage database')
  .addCommand(
    program.createCommand('cleanup')
      .description('Clean up old articles')
      .option('--days <n>', 'Days to keep', '30')
      .action(async (options) => {
        const agent = new RCAgent();
        await agent.initialize();
        const deleted = await agent.cleanupDatabase(parseInt(options.days));
        console.log(`Deleted ${deleted} old articles`);
      })
  )
  .addCommand(
    program.createCommand('stats').description('Show database statistics').action(async () => {
      const agent = new RCAgent();
      await agent.initialize();
      const stats = await agent.getStats();
      if (stats.database) {
        console.log('\n=== Database Statistics ===\n');
        console.log(`Total Articles: ${stats.database.total}`);
        console.log(`Fetched: ${stats.database.fetched}`);
        console.log(`Published: ${stats.database.published}`);
        console.log(`Failed: ${stats.database.failed}`);
        console.log(`Success Rate: ${stats.database.success_rate}%`);
      } else {
        console.log('Database not enabled');
      }
    })
  );

program
  .command('workflow')
  .description('Complete workflow: fetch, fetch-full, publish')
  .option('-k, --keywords <keywords>', 'Override keywords')
  .option('-n, --number <n>', 'Articles to publish', '5')
  .option('--dry-run', 'Preview without publishing')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({
        configPath: options.config,
        cache: true,
        logLevel: options.dryRun ? 'debug' : 'info'
      });
      await agent.initialize();

      console.log('\n=== RC Posty Workflow ===\n');

      console.log('Step 1: Fetching articles...');
      await agent.fetch({ keywords: options.keywords ? options.keywords.split(',') : null });
      console.log(`✓ Found ${agent.articles.length} articles`);

      if (agent.articles.length === 0) {
        console.log('\nNo articles found. Check your keywords and RSS feeds.');
        return;
      }

      console.log('\nStep 2: Fetching full content...');
      const urls = agent.articles.slice(0, parseInt(options.number) + 5).map(a => a.url);
      await agent.fetchArticleContent({ urls });
      console.log(`✓ Updated ${agent.articles.length} articles`);

      console.log('\nStep 3: Publishing...');
      const { summary } = await agent.publish({ articles: agent.articles });

      console.log('\n=== Workflow Complete ===\n');
      console.log(`Articles processed: ${agent.articles.length}`);
      console.log(`Published: ${summary.published}`);
      console.log(`Failed: ${summary.failed}`);

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('schedule')
  .description('Schedule automatic article fetching every 15 minutes')
  .option('--interval <minutes>', 'Interval in minutes', '15')
  .option('--max <n>', 'Maximum articles per run', '10')
  .option('--dry-run', 'Preview without publishing')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const { ArticleScheduler } = await import('./scheduler.js');

      const scheduler = new ArticleScheduler({
        configPath: options.config,
        intervalMinutes: parseInt(options.interval),
        maxArticles: parseInt(options.max),
        dryRun: options.dryRun,
        enabled: true
      });

      await scheduler.runContinuous();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('schedule-once')
  .description('Run scheduler once (fetch and publish articles)')
  .option('-n, --number <n>', 'Number of articles', '10')
  .option('--dry-run', 'Preview without publishing')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const { ArticleScheduler } = await import('./scheduler.js');

      const scheduler = new ArticleScheduler({
        configPath: options.config,
        intervalMinutes: 15,
        maxArticles: parseInt(options.number),
        dryRun: options.dryRun,
        enabled: true
      });

      await scheduler.initialize();
      await scheduler.runOnce();

      const stats = scheduler.getStats();
      console.log('\n=== Stats ===\n');
      console.log(JSON.stringify(stats.stats, null, 2));

      scheduler.stop();
      process.exit(0);

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('process')
  .description('Process articles with AI (raw → processed)')
  .option('-n, --number <n>', 'Number of articles', '5')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      console.log('\n=== Processing Articles with AI ===\n');

      const articles = await agent.db.getArticlesWithContentRaw(parseInt(options.number));
      console.log(`Found ${articles.length} articles to process`);

      let success = 0;
      let failed = 0;

      for (const article of articles) {
        try {
          console.log(`Processing art-${article.article_number}...`);

          const processed = await agent.ollamaClient.processArticle({
            title: article.title,
            content: article.content_raw,
            keywords: [article.keyword]
          });

          await agent.db.updateArticle(article.id, {
            content_processed: processed.content,
            processed_at: new Date().toISOString(),
            status: 'processed',
            stage: 'ai_processed'
          });

          console.log(`  ✓ art-${article.article_number} processed`);
          success++;
        } catch (error) {
          const newRetry = article.retry_count + 1;
          await agent.db.updateArticle(article.id, {
            error: error.message,
            last_error_at: new Date().toISOString(),
            retry_count: newRetry,
            status: newRetry >= 3 ? 'error' : 'raw'
          });

          console.log(`  ✗ art-${article.article_number} failed (retry ${newRetry}/3): ${error.message}`);
          failed++;
        }
      }

      console.log(`\n=== Processing Complete ===\n`);
      console.log(`Success: ${success}`);
      console.log(`Failed: ${failed}`);

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('process-retry')
  .description('Retry failed article processing')
  .option('--id <n>', 'Article number to retry')
  .option('--all', 'Retry all failed articles')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      console.log('\n=== Retry Article Processing ===\n');

      let articles = [];

      if (options.id) {
        const article = await agent.db.getArticleByNumber(parseInt(options.id));
        if (article) articles = [article];
      } else if (options.all) {
        articles = await agent.db.getArticlesWithErrors({ limit: 50 });
      }

      if (articles.length === 0) {
        console.log('No articles to retry');
        return;
      }

      console.log(`Retrying ${articles.length} articles...\n`);

      let success = 0;
      let stillFailed = 0;

      for (const article of articles) {
        try {
          console.log(`Retrying art-${article.article_number} (retry ${article.retry_count + 1})...`);

          const processed = await agent.ollamaClient.processArticle({
            title: article.title,
            content: article.content_raw,
            keywords: [article.keyword]
          });

          await agent.db.updateArticle(article.id, {
            content_processed: processed.content,
            processed_at: new Date().toISOString(),
            status: 'processed',
            stage: 'ai_processed',
            error: null
          });

          console.log(`  ✓ art-${article.article_number} succeeded`);
          success++;
        } catch (error) {
          const newRetry = article.retry_count + 1;
          await agent.db.updateArticle(article.id, {
            error: error.message,
            last_error_at: new Date().toISOString(),
            retry_count: newRetry,
            status: newRetry >= 3 ? 'error' : 'raw'
          });

          console.log(`  ✗ art-${article.article_number} still failed: ${error.message}`);
          stillFailed++;
        }
      }

      console.log(`\n=== Retry Complete ===\n`);
      console.log(`Success: ${success}`);
      console.log(`Still failed: ${stillFailed}`);

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('prepare')
  .description('Prepare articles for publication (processed → ready)')
  .option('-n, --number <n>', 'Number of articles', '5')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      console.log('\n=== Preparing Articles for Publication ===\n');

      const articles = await agent.db.getArticlesByStage('ai_processed', { limit: parseInt(options.number) });
      console.log(`Found ${articles.length} articles to prepare`);

      let prepared = 0;

      for (const article of articles) {
        const cleanedContent = agent.cleanContent(article.content_processed);

        await agent.db.updateArticle(article.id, {
          content_ready: cleanedContent,
          ready_at: new Date().toISOString(),
          status: 'ready',
          stage: 'ready'
        });

        console.log(`✓ art-${article.article_number} prepared`);
        prepared++;
      }

      console.log(`\n=== Preparation Complete ===\n`);
      console.log(`Prepared: ${prepared}`);

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('publish-ready')
  .description('Publish ready articles to WordPress')
  .option('-n, --number <n>', 'Number of articles', '5')
  .option('--dry-run', 'Preview without publishing')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({
        configPath: options.config,
        cache: true,
        logLevel: options.dryRun ? 'debug' : 'info'
      });
      await agent.initialize();

      console.log('\n=== Publishing Ready Articles ===\n');

      const articles = await agent.db.getArticlesReadyToPublish(parseInt(options.number));
      console.log(`Found ${articles.length} articles ready to publish`);

      if (articles.length === 0) {
        console.log('No articles ready to publish');
        return;
      }

      if (options.dryRun) {
        articles.forEach((article, i) => {
          console.log(`${i + 1}. art-${article.article_number}: ${article.title?.substring(60)}...`);
        });
        console.log('\n[Dry run - no articles were published]');
        return;
      }

      const { results, summary } = await agent.publish({ articles });

      console.log('\n=== Publishing Summary ===\n');
      console.log(`Published: ${summary.published}`);
      console.log(`Failed: ${summary.failed}`);
      console.log(`Skipped: ${summary.skipped}`);

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('errors')
  .description('Show articles with errors')
  .option('--list', 'List all errors')
  .option('--retry-all', 'Retry all failed articles')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      console.log('\n=== Articles with Errors ===\n');

      const errors = await agent.db.getArticlesWithErrors({ limit: 100 });

      if (errors.length === 0) {
        console.log('No articles with errors');
        return;
      }

      console.log(`Found ${errors.length} articles with errors:\n`);

      for (const article of errors) {
        console.log(`  art-${article.article_number}`);
        console.log(`    Error: ${article.error?.substring(0, 80)}`);
        console.log(`    Retry: ${article.retry_count}/3`);
        console.log();
      }

      if (options.retryAll) {
        console.log('Use "node src/index.js process-retry --all" to retry all');
      }

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('stats-articles')
  .description('Show detailed article statistics')
  .option('--json', 'Output as JSON')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      const statusStats = await agent.db.getStatsByStatus();
      const rawNumbers = await agent.db.getArticleNumbersByStatus('raw');
      const processedNumbers = await agent.db.getArticleNumbersByStatus('processed');
      const readyNumbers = await agent.db.getArticleNumbersByStatus('ready');
      const errors = await agent.db.getArticlesWithErrors({ limit: 10 });
      const published7d = await agent.db.getPublishedCount(7);
      const publishedArchive = await agent.db.getPublishedArchiveCount();

      if (options.json) {
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          raw: { count: statusStats.raw, max: 5, articles: rawNumbers },
          processed: { count: statusStats.processed, max: 5, articles: processedNumbers },
          ready: { count: statusStats.ready, max: 5, articles: readyNumbers },
          published: { total: statusStats.published, last7days: published7d, archived: publishedArchive },
          errors: { count: statusStats.errors, items: errors.map(e => ({
            articleNumber: e.article_number,
            error: e.error,
            retryCount: e.retry_count
          })) }
        }, null, 2));
        return;
      }

      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║            RC POSTY - STATYSTYKI ARTYKUŁÓW                   ║');
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log('║                                                              ║');
      console.log(`║  📥 RAW (pobrane):            ${String(statusStats.raw).padEnd(5)} / 5                        ║`);
      console.log(`║     Artykuły: ${rawNumbers.slice(0, 3).map(n => `art-${n}`).join(', ')}${rawNumbers.length > 3 ? '...' : ''}`.padEnd(54) + '║');
      console.log('║                                                              ║');
      console.log(`║  ⚙️  PROCESSED (AI):          ${String(statusStats.processed).padEnd(5)} / 5                        ║`);
      console.log(`║     Artykuły: ${processedNumbers.slice(0, 3).map(n => `art-${n}`).join(', ')}${processedNumbers.length > 3 ? '...' : ''}`.padEnd(54) + '║');
      console.log('║                                                              ║');
      console.log(`║  ✅ READY (gotowe):           ${String(statusStats.ready).padEnd(5)} / 5                        ║`);
      console.log(`║     Artykuły: ${readyNumbers.slice(0, 3).map(n => `art-${n}`).join(', ')}${readyNumbers.length > 3 ? '...' : ''}`.padEnd(54) + '║');
      console.log('║                                                              ║');
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log('║                                                              ║');
      console.log(`║  📤 PUBLISHED:                ${String(statusStats.published).padEnd(5)} (aktywne)              ║`);
      console.log(`║     Ostatnie 7 dni:           ${String(published7d).padEnd(5)}                            ║`);
      console.log(`║     W archiwum:               ${String(publishedArchive).padEnd(5)}                            ║`);
      console.log('║                                                              ║');
      console.log(`║  ❌ BŁĘDY:                    ${String(statusStats.errors).padEnd(5)}                            ║`);
      errors.slice(0, 3).forEach(e => {
        console.log(`║     art-${String(e.article_number).padEnd(3)} (retry ${e.retry_count}/3): ${e.error?.substring(0, 25) || 'unknown'}...`.padEnd(54) + '║');
      });
      console.log('║                                                              ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('db')
  .description('Manage database')
  .addCommand(
    program.createCommand('cleanup')
      .description('Clean up old articles (4 days retention)')
      .option('--force', 'Force cleanup')
      .action(async (options) => {
        const agent = new RCAgent();
        await agent.initialize();

        console.log('\n=== Database Cleanup ===\n');

        const config = agent.config.cleanup || {};
        const rawDays = config.rawMaxAgeDays || 4;
        const processedDays = config.processedMaxAgeDays || 4;
        const readyDays = config.readyMaxAgeDays || 4;

        const rawDeleted = await agent.db.deleteByAge('raw', rawDays);
        const processedDeleted = await agent.db.deleteByAge('processed', processedDays);
        const readyDeleted = await agent.db.deleteByAge('ready', readyDays);

        console.log(`Deleted raw (${rawDays} dni): ${rawDeleted.deleted}`);
        console.log(`Deleted processed (${processedDays} dni): ${processedDeleted.deleted}`);
        console.log(`Deleted ready (${readyDays} dni): ${readyDeleted.deleted}`);

        const archiveResult = await agent.db.archiveOldPublished(config.publishedArchiveDays || 90);
        console.log(`Archived old published: ${archiveResult.archived}`);

        agent.close();
      })
  )
  .addCommand(
    program.createCommand('archive')
      .description('Archive published articles')
      .option('--days <n>', 'Archive articles older than days', '90')
      .action(async (options) => {
        const agent = new RCAgent();
        await agent.initialize();

        const result = await agent.db.archiveOldPublished(parseInt(options.days));
        console.log(`Archived ${result.archived} articles`);

        agent.close();
      })
  )
    .addCommand(
    program.createCommand('stats')
      .description('Show database statistics')
      .action(async () => {
        const agent = new RCAgent();
        await agent.initialize();
        const stats = await agent.getStats();
        if (stats.database) {
          console.log('\n=== Database Statistics ===\n');
          console.log(`Total Articles: ${stats.database.total}`);
          console.log(`Fetched: ${stats.database.fetched}`);
          console.log(`Published: ${stats.database.published}`);
          console.log(`Failed: ${stats.database.failed}`);
          console.log(`Success Rate: ${stats.database.success_rate}%`);
        } else {
          console.log('Database not enabled');
        }
      })
  );

program
  .command('custom-feeds')
  .description('Fetch articles from custom RSS feeds')
  .option('-n, --number <n>', 'Max articles per feed', '10')
  .option('--save', 'Save to database')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const { CustomFeedFetcher } = await import('./custom-feed-fetcher.js');
      const { ArticleDatabase } = await import('./database.js');

      const fetcher = new CustomFeedFetcher();
      const configPath = options.config || './config/default.json';
      const { ConfigManager } = await import('./config-manager.js');
      const configManager = new ConfigManager(configPath);
      const config = await configManager.loadConfig();

      console.log('\n=== Custom RSS Feeds Fetcher ===\n');

      const feeds = config.rss?.customFeeds?.filter(f => f.enabled) || [];
      console.log(`Found ${feeds.length} enabled custom feeds\n`);

      const result = await fetcher.fetchFeeds(feeds, {
        maxItemsPerFeed: parseInt(options.number),
        maxTotalItems: 50,
        minScore: 1
      });

      console.log('=== Results ===\n');
      console.log(`Feeds processed: ${result.stats.processed}/${result.stats.totalFeeds}`);
      console.log(`Feeds failed: ${result.stats.failed}`);
      console.log(`Articles found: ${result.stats.totalItems}`);
      console.log(`Articles filtered (no keywords): ${result.stats.filtered}\n`);

      if (result.items.length > 0) {
        console.log('Top articles:');
        result.items.slice(0, 5).forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.title?.substring(60)}...`);
          console.log(`     Source: ${item.source}`);
          console.log(`     Keywords: ${item.keywords.join(', ')} (score: ${item.keywordScore})`);
        });
      }

      if (options.save && result.items.length > 0) {
        console.log('\n=== Saving to Database ===\n');

        const db = new ArticleDatabase({ path: config.database?.path || './data/articles.db', enabled: true });
        db.initialize();

        const { saved, skipped } = await fetcher.saveToDatabase(result.items, db);
        await fetcher.updateKeywordsStats(result.items, db);

        console.log(`Saved: ${saved}`);
        console.log(`Skipped (duplicate): ${skipped}`);

        db.close();
      }

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('keywords')
  .description('Manage keywords database')
  .addCommand(
    program.createCommand('list')
      .description('List all keywords')
      .action(async () => {
        try {
          const fs = await import('fs');
          const keywordsPath = './data/keywords.json';

          if (!fs.existsSync(keywordsPath)) {
            console.log('Keywords file not found. Run "node src/index.js keywords sync" first.');
            return;
          }

          const data = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

          console.log('\n=== Keywords Database ===\n');
          console.log(`Total: ${data.keywords.length}`);
          console.log(`Enabled: ${data.keywords.filter(k => k.enabled).length}`);
          console.log(`Last updated: ${data.lastUpdated}\n`);

          data.keywords.forEach(k => {
            const status = k.enabled ? '✓' : '✗';
            console.log(`  ${status} [${k.category}] ${k.word} (matches: ${k.matchCount || 0})`);
          });

        } catch (error) {
          console.error(`Error: ${error.message}`);
        }
      })
  )
  .addCommand(
    program.createCommand('sync')
      .description('Sync keywords from config to database')
      .action(async () => {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const { fileURLToPath } = await import('url');

          const __filename = fileURLToPath(import.meta.url);
          const __dirname = path.dirname(__filename);
          const keywordsPath = path.join(__dirname, '../../data/keywords.json');

          const { ConfigManager } = await import('./config-manager.js');
          const configManager = new ConfigManager();
          const config = await configManager.loadConfig();
          const keywords = config.keywords || [];

          const existingData = fs.existsSync(keywordsPath)
            ? JSON.parse(fs.readFileSync(keywordsPath, 'utf8'))
            : { version: "1.0", lastUpdated: new Date().toISOString(), keywords: [], categories: {} };

          const categoryMap = {
            'sales': 'Sprzedaż',
            'soft-skills': 'Kompetencje miękkie',
            'leadership': 'Przywództwo',
            'training': 'Szkolenia',
            'business': 'Biznes',
            'development': 'Rozwój',
            'psychology': 'Psychologia'
          };

          const newKeywords = [];
          let id = 1;

          for (const word of keywords) {
            const existing = existingData.keywords?.find(k => k.word === word);
            newKeywords.push({
              id: id++,
              word: word,
              enabled: true,
              priority: 'medium',
              category: 'general',
              source: 'config',
              lastSearch: existing?.lastSearch || null,
              articleCount: existing?.articleCount || 0,
              matchCount: existing?.matchCount || 0
            });
          }

          existingData.keywords = newKeywords;
          existingData.lastUpdated = new Date().toISOString();
          existingData.stats = {
            totalKeywords: newKeywords.length,
            enabledKeywords: newKeywords.length,
            totalMatches: existingData.stats?.totalMatches || 0,
            lastFetchDate: null
          };

          fs.writeFileSync(keywordsPath, JSON.stringify(existingData, null, 2));

          console.log(`\n=== Keywords Synced ===\n`);
          console.log(`Total keywords: ${newKeywords.length}`);
          console.log(`File: ${keywordsPath}`);

        } catch (error) {
          console.error(`Error: ${error.message}`);
        }
      })
  )
  .addCommand(
    program.createCommand('stats')
      .description('Show keywords statistics')
      .action(async () => {
        try {
          const fs = await import('fs');
          const keywordsPath = './data/keywords.json';

          if (!fs.existsSync(keywordsPath)) {
            console.log('Keywords file not found.');
            return;
          }

          const data = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

          console.log('\n=== Keywords Statistics ===\n');
          console.log(`Total keywords: ${data.keywords?.length || 0}`);
          console.log(`Enabled: ${data.keywords?.filter(k => k.enabled).length || 0}`);
          console.log(`Total matches: ${data.stats?.totalMatches || 0}`);
          console.log(`Last fetch: ${data.stats?.lastFetchDate || 'Never'}`);

          const categoryStats = {};
          data.keywords?.forEach(k => {
            const cat = k.category || 'general';
            categoryStats[cat] = (categoryStats[cat] || 0) + 1;
          });

          console.log('\nBy category:');
          for (const [cat, count] of Object.entries(categoryStats)) {
            console.log(`  ${cat}: ${count}`);
          }

        } catch (error) {
          console.error(`Error: ${error.message}`);
        }
      })
  );

program
  .command('auto-workflow')
  .description('Full automated workflow: custom-feeds → fetch-full → process → prepare')
  .option('-n, --number <n>', 'Articles per stage', '2')
  .option('--feeds-only', 'Only custom feeds fetch')
  .option('--dry-run', 'Preview without publishing')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const { CustomFeedFetcher } = await import('./custom-feed-fetcher.js');
      const { ArticleDatabase } = await import('./database.js');
      const { ConfigManager } = await import('./config-manager.js');
      const { ArticleSourceManager } = await import('./article-source.js');
      const RCAgent = (await import('./rc-agent.js')).RCAgent;

      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      const config = agent.config;
      const db = agent.db;
      const fetcher = new CustomFeedFetcher();

      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║           RC POSTY - AUTO WORKFLOW (Qwen 6GB)                ║');
      console.log('╚══════════════════════════════════════════════════════════════╝\n');

      // Step 1: Custom Feeds
      console.log('📥 STEP 1: Custom RSS Feeds\n');
      const feeds = config.rss?.customFeeds?.filter(f => f.enabled) || [];
      const feedResult = await fetcher.fetchFeeds(feeds, {
        maxItemsPerFeed: parseInt(options.number),
        maxTotalItems: parseInt(options.number) * 2,
        minScore: 1
      });

      if (feedResult.items.length > 0) {
        const { saved } = await fetcher.saveToDatabase(feedResult.items, db);
        await fetcher.updateKeywordsStats(feedResult.items, db);
        console.log(`✓ Saved ${saved} articles from custom feeds\n`);
      } else {
        console.log('No articles from custom feeds\n');
      }

      if (options.feedsOnly) {
        agent.close();
        return;
      }

      // Step 2: Fetch-full for new articles
      console.log('📄 STEP 2: Fetch Full Content\n');
      const rawArticles = await db.getArticlesByStatus('raw', { limit: 10 });
      const articlesNeedingContent = rawArticles.filter(a => !a.content_raw || a.content_raw.length < 100);

      if (articlesNeedingContent.length > 0) {
        const urls = articlesNeedingContent.map(a => a.url).filter(Boolean);
        if (urls.length > 0) {
          const fetched = await agent.fetchArticleContent({ urls });
          const successCount = fetched.filter(a => a.success).length;

          for (const f of fetched) {
            if (f.success) {
              const original = articlesNeedingContent.find(a => a.url === f.url);
              if (original) {
                await db.updateArticle(original.id, {
                  content_raw: f.content,
                  stage: 'content_extracted'
                });
              }
            }
          }
          console.log(`✓ Fetched full content: ${successCount}/${urls.length}\n`);
        }
      } else {
        console.log('No articles need full content fetch\n');
      }

      // Step 3: Process with AI (Qwen)
      console.log('🤖 STEP 3: AI Processing (Qwen 6GB)\n');
      const articlesToProcess = await db.getArticlesWithContentRaw(parseInt(options.number));
      let processed = 0;

      for (const article of articlesToProcess) {
        try {
          console.log(`Processing art-${article.article_number}...`);

          const result = await agent.ollamaClient.processArticle({
            title: article.title,
            content: article.content_raw?.substring(0, 1500),
            keywords: [article.keyword]
          });

          await db.updateArticle(article.id, {
            content_processed: result.content,
            processed_at: new Date().toISOString(),
            status: 'processed',
            stage: 'ai_processed'
          });

          console.log(`  ✓ art-${article.article_number} processed\n`);
          processed++;

          if (processed >= parseInt(options.number)) break;
        } catch (error) {
          console.log(`  ✗ art-${article.article_number} failed: ${error.message.substring(0, 50)}\n`);
        }
      }

      // Step 4: Prepare for publication
      console.log('✅ STEP 4: Prepare for Publication\n');
      const articlesToPrepare = await db.getArticlesByStage('ai_processed', { limit: parseInt(options.number) });
      let prepared = 0;

      for (const article of articlesToPrepare) {
        const cleaned = agent.cleanContent(article.content_processed);

        await db.updateArticle(article.id, {
          content_ready: cleaned,
          ready_at: new Date().toISOString(),
          status: 'ready',
          stage: 'ready'
        });

        console.log(`✓ art-${article.article_number} ready for publishing`);
        prepared++;
      }

      console.log('\n╔══════════════════════════════════════════════════════════════╗');
      console.log('║                    WORKFLOW COMPLETE                          ║');
      console.log('╠══════════════════════════════════════════════════════════════╣');
      console.log(`║  Custom feeds: ${String(feedResult.stats.totalItems).padEnd(46)}║`);
      console.log(`║  AI processed: ${String(processed).padEnd(46)}║`);
      console.log(`║  Ready to publish: ${String(prepared).padEnd(43)}║`);
      console.log('╚══════════════════════════════════════════════════════════════╝\n');

      agent.close();

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
