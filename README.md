# RC Posty v2.0

Web content fetcher and publisher. Fetches articles from RSS feeds and web search, publishes to WordPress.

## Features

- **RSS Fetching**: Automatic RSS feeds from Google News based on keywords + custom feeds
- **Web Search**: DuckDuckGo search for latest articles
- **Content Fetching**: Full article content extraction with metadata
- **WordPress Publishing**: Publish articles with categories
- **Caching**: Built-in cache to avoid duplicate fetches
- **Logging**: File-based logging
- **Safety**: URL validation, rate limiting

---

## 🚀 Jak Korzystać

### Wymagania

- Node.js 18+
- Ollama (opcjonalnie, do generowania artykułów)
- WordPress REST API dostęp

### Instalacja

```bash
# Instalacja zależności
npm install
```

---

### ⚙️ Konfiguracja

Edytuj `config/default.json`:

```json
{
  "keywords": ["cryptocurrency", "bitcoin", "ethereum", "ai"],
  "rss": {
    "googleNews": true,
    "customFeeds": [
      "https://cointelegraph.com/rss",
      "https://bitcoinmagazine.com/feed"
    ]
  },
  "search": {
    "maxResults": 10,
    "maxAgeDays": 7,
    "concurrency": 3
  },
  "endpoints": {
    "wordpress": {
      "url": "https://twoj-sit.com/wp-json/wp/v2/posts",
      "auth": {
        "username": "admin",
        "password": "app-password"
      }
    }
  },
  "publish": {
    "categories": ["News", "Technology"],
    "dryRun": false
  }
}
```

#### Zmienne środowiskowe

```bash
export WORDPRESS_URL="https://site.com/wp-json/wp/v2/posts"
export WORDPRESS_USER="admin"
export WORDPRESS_PASS="app-password"
export OLLAMA_URL="http://localhost:11434"
export OLLAMA_MODEL="llama3"
```

---

### 📋 Dostępne Komendy

#### 1. Status Systemu
```bash
node src/index.js status
```
Pokazuje konfigurację, słowa kluczowe, status WordPress/Ollama.

#### 2. Pobieranie Artykułów
```bash
# Użyj słów kluczowych z config
node src/index.js fetch

# Override słów kluczowych
node src/index.js fetch -k "bitcoin,ethereum,ai"

# Przykładowy wynik:
# === Results ===
# RSS Articles: 10
# Web Articles: 5
# Total: 15
```

#### 3. Pobieranie Pełnej Treści
```bash
# Pobierz treść 5 artykułów
node src/index.js fetch-full -n 5

# Przykładowy wynik:
# ✓ 1. Article title...
#    2500 chars | Excerpt...
```

#### 4. Publikowanie na WordPress
```bash
# Publikuj 10 artykułów
node src/index.js publish -n 10

# Podgląd bez publikowania
node src/index.js publish --dry-run

# Przykładowy wynik:
# === Publishing Summary ===
# Published: 8
# Failed: 2
```

#### 5. Generowanie Artykułu (Ollama)
```bash
# Z domyślnymi słowami kluczowymi
node src/index.js generate

# Z własnymi słowami i stylem
node src/index.js generate -k "ai,tech" -s professional
```

Dostępne style: `professional`, `casual`, `technical`, `creative`

#### 6. Zarządzanie Cache
```bash
# Wyczyść cache
node src/index.js cache clear

# Status cache
node src/index.js cache status
```

#### 7. Pełny Workflow
```bash
# Pobierz → pobierz treść → opublikuj
node src/index.js workflow

# Z podglądem (bez publikowania)
node src/index.js workflow --dry-run

# Z własnymi słowami kluczowymi
node src/index.js workflow -k "bitcoin" -n 5

# Przykładowy wynik:
# === RC Posty Workflow ===
# Step 1: Fetching articles...
# ✓ Found 15 articles
# Step 2: Fetching full content...
# ✓ Updated 10 articles
# Step 3: Publishing...
# === Workflow Complete ===
# Articles processed: 10
# Published: 8
# Failed: 2
```

---

### 📊 Opcje Konfiguracji

| Parametr | Opis | Domyślnie |
|----------|------|-----------|
| `keywords` | Słowa kluczowe do wyszukiwania | wymagane |
| `rss.googleNews` | Automatyczne feedy z Google News | `true` |
| `rss.customFeeds` | Własne URL-e RSS | `[]` |
| `search.maxResults` | Max artykułów do pobrania | `10` |
| `search.maxAgeDays` | Tylko artykuły z X dni | `7` |
| `search.concurrency` | Równoległe pobieranie | `3` |
| `search.delayMs` | Opóźnienie między requestami (ms) | `1000` |
| `publish.categories` | Kategorie WordPress | `[]` |
| `publish.dryRun` | Tryb podglądu | `false` |

---

### 📁 Struktura Plików

```
rcposty/
├── config/
│   └── default.json           # Konfiguracja główna
├── src/
│   ├── index.js               # CLI entry point
│   ├── rc-agent.js            # Główny agent
│   ├── config-manager.js      # Zarządzanie konfiguracją
│   ├── web-searcher.js        # Wyszukiwanie web + ekstrakcja
│   ├── rss-fetcher.js         # Parser RSS
│   ├── ollama-client.js       # Ollama integration
│   └── utils/
│       ├── validation.js      # URL validation, rate limiting
│       └── cache.js           # Cache + logging
├── cache/                     # Pliki cache (TTL: 1h)
└── logs/                      # Logi (logs/YYYY-MM-DD.log)
```

---

### 🔧 Rozwiązywanie Problemów

#### Brak artykułów z web search
- DuckDuckGo może blokować requesty z serwera
- Sprawdź logi: `cat logs/2026-01-30.log`
- Zwiększ `delayMs` w konfiguracji

#### WordPress nie działa
- Upewnij się, że używasz **Application Password** (WordPress 5.6+)
- Sprawdź URL: musi kończyć się na `/wp-json/wp/v2/posts`
- Włącz REST API w WordPress: Ustawienia > Bezpieczeństwo

#### Cache
```bash
# Wyczyść jeśli są problemy
node src/index.js cache clear

# Cache jest automatycznie usuwany po 1 godzinie
```

#### Rate Limiting
Domyślne limity:
- RSS: 20 requestów/min
- Web search: 10 requestów/min
- WordPress: 30 requestów/min

---

### 📝 Przykładowy Config

```json
{
  "keywords": [
    "cryptocurrency",
    "blockchain",
    "defi",
    "bitcoin",
    "ethereum",
    "web3",
    "ai",
    "technology"
  ],
  "rss": {
    "googleNews": true,
    "customFeeds": [
      "https://cointelegraph.com/rss",
      "https://bitcoinmagazine.com/feed",
      "https://techcrunch.com/feed/"
    ]
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3"
  },
  "article": {
    "style": "professional"
  },
  "search": {
    "maxResults": 10,
    "maxAgeDays": 7,
    "concurrency": 3,
    "delayMs": 1000
  },
  "endpoints": {
    "wordpress": {
      "url": "https://twoj-sit.com/wp-json/wp/v2/posts",
      "auth": {
        "username": "admin",
        "password": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  },
  "publish": {
    "categories": ["News", "Technology"],
    "dryRun": false
  }
}
```

---

## Wymagania

- Node.js 18+
- Ollama (opcjonalnie, do generowania artykułów)
- WordPress z włączonym REST API (5.6+)
# rssposty
