# RC Posty v2.0

Web content fetcher and publisher for WordPress with AI-powered article generation.

## Features

- **RSS Fetching**: Automatic RSS feeds from Google News + custom feeds
- **Web Search**: Multi-source search (DuckDuckGo, RSS, Bing, Google)
- **Content Extraction**: Smart article content extraction with fallback
- **WordPress Publishing**: Publish with categories and retry logic
- **AI Article Generation**: Generate articles using Ollama/Llama
- **Database**: SQLite storage for article tracking and history
- **Scheduler**: Automated fetching on configurable intervals
- **Monitoring**: Health checks and statistics

## Installation

```bash
npm install
```

## Configuration

Edit `config/default.json`:

```json
{
  "keywords": ["szkolenia sprzedażowe", "kompetencje miękkie", "rozwój zespołu"],
  
  "search": {
    "sources": ["duckduckgo", "rss"],
    "maxResults": 15,
    "maxAgeDays": 7
  },
  
  "wordpress": {
    "url": "https://your-site.com/wp-json/wp/v2/posts",
    "auth": {
      "username": "admin",
      "password": "APPLICATION_PASSWORD"
    },
    "categories": ["News", "Business"]
  },
  
  "scheduler": {
    "enabled": true,
    "cron": "*/15 * * * *",
    "maxArticles": 10
  }
}
```

### WordPress Setup

1. Go to WordPress Admin → Users → Profile
2. Find "Application Passwords" section
3. Enter name (e.g., "RC Posty") and click "Add New"
4. Copy the generated password
5. Update config with the new password

## Usage

### Status & Monitoring

```bash
# System status
node src/index.js status

# Detailed statistics
node src/index.js stats

# Health check monitor
node src/index.js monitor --once

# Continuous monitoring every 60 seconds
node src/index.js monitor
```

### Fetching Articles

```bash
# Fetch with default keywords
node src/index.js fetch

# Fetch with custom keywords
node src/index.js fetch -k "bitcoin,ai,technology"

# Fetch full content for first 10 articles
node src/index.js fetch-full -n 10
```

### WordPress Publishing

```bash
# Test WordPress connection
node src/index.js wp-test

# Publish articles (dry run)
node src/index.js publish --dry-run -n 5

# Publish for real
node src/index.js publish -n 5
```

### Complete Workflow

```bash
# Fetch → fetch content → publish
node src/index.js workflow -n 5

# Preview without publishing
node src/index.js workflow -n 5 --dry-run
```

### AI Article Generation

```bash
# Generate article with Ollama
node src/index.js generate -k "kompetencje miękkie" -s professional
```

### Database Management

```bash
# Show database statistics
node src/index.js db stats

# Clean up old articles (older than 30 days)
node src/index.js db cleanup --days 30

# Clear cache
node src/index.js cache clear
```

### Scheduling

```bash
# Run scheduler once (fetch and publish)
node src/index.js schedule-once -n 10

# Start continuous scheduler (every 15 minutes)
node src/index.js schedule

# Custom interval (every 30 minutes, max 15 articles)
node src/index.js schedule --interval 30 --max 15
```

## Project Structure

```
rcposty/
├── config/
│   └── default.json           # Configuration
├── src/
│   ├── index.js               # CLI entry point
│   ├── rc-agent.js            # Main agent
│   ├── scheduler.js           # Scheduled fetching
│   ├── monitor.js             # System monitoring
│   ├── database.js            # SQLite database
│   ├── article-source.js      # Multi-source search
│   ├── wordpress-manager.js   # WordPress publishing
│   ├── rss-fetcher.js         # RSS parsing
│   ├── web-searcher.js        # Web search & extraction
│   ├── ollama-client.js       # Ollama integration
│   ├── config-manager.js      # Config handling
│   ├── setup-wordpress.js     # WP setup wizard
│   └── utils/
│       ├── validation.js      # URL validation, deduplication
│       └── cache.js           # Cache & logging
├── data/                      # SQLite database storage
├── cache/                     # Article cache
├── logs/                      # Application logs
└── templates/                 # Article templates
```

## API Reference

### RCAgent

```javascript
import { RCAgent } from './rc-agent.js';

const agent = new RCAgent();
await agent.initialize();

await agent.fetch({ keywords: ['topic1', 'topic2'] });
await agent.fetchArticleContent({ urls: [...], maxResults: 10 });
await agent.publish({ articles: [...] });

const stats = await agent.getStats();
agent.close();
```

### ArticleDatabase

```javascript
import { ArticleDatabase } from './database.js';

const db = new ArticleDatabase({ path: './data/articles.db' });
db.initialize();

await db.saveArticle({ url, title, content, ... });
const articles = await db.getArticles({ status: 'fetched', limit: 10 });
const stats = await db.getStats();

await db.markAsPublished(url, wpPostId);
await db.cleanup(30);
db.close();
```

## Scheduler Cron Expression

```
*/15 * * * *     Every 15 minutes
0 * * * *        Every hour
0 8 * * *        Every day at 8 AM
0 8 * * 1        Every Monday at 8 AM
```

## Troubleshooting

### WordPress 401 Error
- Make sure you're using an Application Password, not your login password
- Go to WordPress Admin → Users → Profile → Application Passwords
- Create new password and update config

### No Articles Found
- Check keywords are relevant and not too niche
- Increase `maxAgeDays` in config
- Check logs in `logs/` directory

### DuckDuckGo Blocked
- Some sites block automated access
- System automatically falls back to RSS sources
- Consider adding custom RSS feeds to config

## Requirements

- Node.js 18+
- Ollama (optional, for AI generation)
- WordPress 5.6+ with REST API enabled
