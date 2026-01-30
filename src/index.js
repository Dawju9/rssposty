#!/usr/bin/env node

import { Command } from 'commander';
import { RCAgent } from './rc-agent.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('rcposty')
  .description('Web content fetcher and publisher')
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
      const status = agent.getStatus();

      console.log('\n=== RC Posty Status ===\n');
      console.log('Configuration:');
      console.log(`  Status: ${status.config.status}`);
      console.log(`  Keywords: ${status.keywords.join(', ')}`);
      console.log(`  RSS Feeds: ${status.rss.totalFeeds} (${status.rss.googleNews ? 'Google News + ' : ''}${status.rss.customFeeds.length} custom)`);
      console.log(`  Ollama: ${status.ollama}`);

      console.log('\nSearch Settings:');
      console.log(`  Max Results: ${status.search.maxResults}`);
      console.log(`  Max Age: ${status.search.maxAgeDays} days`);
      console.log(`  Concurrency: ${status.search.concurrency}`);

      console.log('\nPublishing:');
      console.log(`  WordPress: ${status.config.wordpressConfigured ? '✓' : '✗'}`);
      console.log(`  Dry Run: ${status.publish.dryRun ? 'Yes' : 'No'}`);
      console.log(`  Categories: ${status.publish.categories.join(', ') || 'none'}`);

      console.log('\nData:');
      console.log(`  Articles: ${status.articlesCount}`);
      console.log(`  Cache: ${status.cache ? 'enabled' : 'disabled'}`);

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('fetch')
  .description('Fetch articles from RSS and web based on keywords')
  .option('-k, --keywords <keywords>', 'Override keywords (comma-separated)')
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
        agent.articles.slice(0, 5).forEach((article, i) => {
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
  .option('-n, --number <n>', 'Number of articles', '5')
  .option('-c, --config <path>', 'Config file path')
  .action(async (options) => {
    try {
      const agent = new RCAgent({ configPath: options.config });
      await agent.initialize();

      if (agent.articles.length === 0) {
        console.log('No articles. Run "fetch" first.');
        process.exit(0);
      }

      const urls = agent.articles.slice(0, parseInt(options.number)).map(a => a.url);

      console.log(`\nFetching full content for ${urls.length} articles...\n`);

      const articles = await agent.fetchArticleContent({ urls });

      let i = 0;
      for (const article of articles) {
        if (article.success) {
          i++;
          console.log(`✓ ${i}. ${article.title?.substring(50)}...`);
          console.log(`   ${article.content?.length} chars | ${article.excerpt?.substring(0, 80)}...`);
        }
      }

      agent.setArticles(articles);
      console.log(`\nUpdated ${articles.filter(a => a.success).length} articles with full content`);

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
      const status = new RCAgent().cache.getStatus();
      console.log('Cache enabled:', status.configured);
      console.log('Last operation:', status.lastFetch);
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

    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();
