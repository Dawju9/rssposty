# RC Posty - Dokumentacja Workflow Artykułów

## 1. STRUKTURA BAZY DANYCH

### Główna tabela `articles`

```sql
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_number INTEGER,           -- Numer: art-1, art-2, art-999
  retry_count INTEGER DEFAULT 0,    -- Licznik prób (0-3)
  url TEXT,                         -- NULL dla AI-only
  title TEXT,
  content_raw TEXT,                 -- Surowa treść pobrana
  content_processed TEXT,           -- Przetworzona przez AI
  content_ready TEXT,               -- Gotowa do publikacji
  source TEXT,                      -- 'rss', 'duckduckgo', 'generated'
  keyword TEXT,                     -- Słowo kluczowe
  status TEXT DEFAULT 'raw',        -- 'raw', 'processed', 'ready', 'published'
  stage TEXT DEFAULT 'none',        -- 'fetched', 'content_extracted', 'ai_processed', 'ready'
  error TEXT,                       -- Ostatni błąd
  last_error_at TEXT,               -- Data ostatniego błędu
  published_at TEXT,                -- Data publikacji
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  ready_at TEXT,
  wp_post_id INTEGER                -- ID posta na WordPress
);

CREATE INDEX idx_articles_number ON articles(article_number);
CREATE INDEX idx_articles_status ON articles(status);
CREATE INDEX idx_articles_stage ON articles(stage);
CREATE INDEX idx_articles_error ON articles(error);
CREATE INDEX idx_articles_fetched ON articles(fetched_at);
```

### Tabela archiwum `published_articles`

```sql
CREATE TABLE published_articles (
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

CREATE INDEX idx_published_wp ON published_articles(wp_post_id);
CREATE INDEX idx_published_date ON published_articles(published_at);
```

---

## 2. STATUSY I ETAPY ARTYKUŁÓW

### Statusy (status)

| Status | Opis | Retencja | Max w bazie |
|--------|------|----------|-------------|
| `raw` | Surowy, pobrany z sieci | 4 dni | 5 |
| `processed` | Przetworzony przez AI | 4 dni | 5 |
| `ready` | Gotowy do publikacji | 4 dni | 5 |
| `published` | Opublikowany | archiwum | bez limitu |

### Etapy (stage)

| Stage | Opis |
|-------|------|
| `none` | Nowy artykuł |
| `fetched` | Pobrane metadane |
| `content_extracted` | Pełna treść pobrana |
| `ai_processed` | Przetworzony przez AI |
| `ready` | Gotowy do publikacji |
| `published` | Na WordPress |

---

## 3. POLITYKA CZYSZCZENIA

### Automatyczne czyszczenie (co 24h)

| Status | Retencja | Max w bazie |
|--------|----------|-------------|
| `raw` | 4 dni | 5 |
| `processed` | 4 dni | 5 |
| `ready` | 4 dni | 5 |
| `published` | archiwum (>90 dni) | bez limitu |

---

## 4. POLECENIA CLI (KOMENDY)

### Główne komendy

```bash
# === POBIERANIE ===
node src/index.js fetch                    # Pobierz artykuły (raw)
node src/index.js fetch -k "keyword"       # Pobierz z konkretnym keywordem
node src/index.js fetch -n 5               # Pobierz max 5 artykułów

# === POBIERANIE TREŚCI ===
node src/index.js fetch-full               # Pobierz treść dla raw artykułów
node src/index.js fetch-full -n 5          # Tylko 5 artykułów

# === PRZETWARZANIE AI ===
node src/index.js process                  # Przetwórz raw → processed (AI)
node src/index.js process -n 5             # Tylko 5 artykułów
node src/index.js process-retry --id 32    # Retry konkretnego artykułu
node src/index.js process-retry --all      # Retry wszystkich z błędami

# === PRZYGOTOWANIE DO PUBLIKACJI ===
node src/index.js prepare                  # Oczyszczanie processed → ready
node src/index.js prepare -n 5             # Tylko 5 artykułów

# === PUBLIKACJA ===
node src/index.js publish-ready            # Publikuj ready → published
node src/index.js publish-ready -n 5       # Max 5 artykułów
node src/index.js publish-ready --dry-run  # Podgląd bez publikacji

# === PEŁNY WORKFLOW ===
node src/index.js workflow --full          # fetch → fetch-full → process → prepare → publish
node src/index.js workflow --full -n 5     # Max 5 artykułów

# === CZYSZCZENIE I ARCHIWIZACJA ===
node src/index.js db cleanup               # Czyszczenie według polityki
node src/index.js db cleanup --force       # Wymuszone czyszczenie
node src/index.js db archive               # Archiwizacja publikacji
node src/index.js db archive --days 30     # Archiwizuj starsze niż 30 dni

# === STATYSTYKI ===
node src/index.js status                   # Szybki status
node src/index.js stats                    # Szczegółowe statystyki JSON
node src/index.js stats-articles           # Statystyki artykułów (nowe!)
node src/index.js stats-articles --json    # JSON format

# === BŁĘDY I RETRY ===
node src/index.js errors                   # Lista błędów
node src/index.js errors --list            # To samo
node src/index.js errors --retry-all       # Retry wszystkich z błędami

# === POMOC ===
node src/index.js --help                   # Lista komend
node src/index.js <komend> --help          # Pomoc dla komendy
```

---

## 5. PRZYKŁADY UŻYCIA

### Scenariusz 1: Pojedynczy artykuł

```bash
# 1. Pobierz
$ node src/index.js fetch -k "szkolenia sprzedażowe"
→ Pobrano 5 artykułów: art-1, art-2, art-3, art-4, art-5

# 2. Pobierz treść
$ node src/index.js fetch-full -n 5
→ Pobrano treść dla art-1 do art-5 (stage: content_extracted)

# 3. Przetwórz AI
$ node src/index.js process -n 5
→ Sukces: art-1, art-2, art-3 → processed
→ Błąd: art-4 (AI timeout) → retry_count=1
→ Błąd: art-5 (content empty) → retry_count=1

# 4. Oczyszczanie
$ node src/index.js prepare -n 3
→ art-1, art-2, art-3 → ready

# 5. Publikacja
$ node src/index.js publish-ready -n 3
→ Opublikowano: art-1, art-2, art-3
→ Przeniesione do published_articles
→ Usunięte z articles
```

### Scenariusz 2: Retry błędów

```bash
# Sprawdź błędy
$ node src/index.js errors
❌ BŁĘDY DO RETRY:
   art-4 (błąd: AI timeout, retry: 1/3)
   art-5 (błąd: content empty, retry: 1/3)

# Retry konkretnego
$ node src/index.js process-retry --id 4
→ art-4-01 (nowy retry) → processed ✓

# Retry wszystkich
$ node src/index.js errors --retry-all
→ art-4-01 → processed ✓
→ art-5-01 → processed ✓
```

### Scenariusz 3: Pełny automat

```bash
# Jedna komenda - wszystko
$ node src/index.js workflow --full -n 5

=== WORKFLOW ===
1. Fetch: 5 artykułów (art-1 do art-5) ✓
2. Fetch-full: 5 treści ✓
3. Process: 4 sukces, 1 błąd ✓
4. Prepare: 4 ready ✓
5. Publish: 4 opublikowane ✓

Podsumowanie:
   Pobrane: 5
   Przetworzone: 4
   Opublikowane: 4
   Błędy: 1 (art-5)
```

### Scenariusz 4: Czyszczenie

```bash
# Sprawdź statystyki przed czyszczeniem
$ node src/index.js stats-articles

=== RC Posty - Statystyki Artykułów ===
...
🧹 Cleanup za: 12h

# Wymuś czyszczenie
$ node src/index.js db cleanup --force
→ Usunięto art-1 (raw, 5 dni)
→ Usunięto art-2 (raw, 5 dni)
→ Archiwizowano 3 publikacje (>90 dni)
```

---

## 6. WORKFLOW PRZETWARZANIA

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TRÓJSTOPNIOWY WORKFLOW                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  STAGE 1: FETCH                                                          │
│  ═════════════════                                                       │
│  Input:  Keyword (z config lub -k)                                       │
│  Output: articles z {url, title, description, source, keyword}           │
│  Status: 'raw', stage: 'fetched'                                         │
│  Storage: articles table                                                 │
│  Limit: 5 max w bazie                                                    │
│                                                                         │
│         ↓                                                                │
│                                                                         │
│  STAGE 2: FETCH-FULL                                                     │
│  ═════════════════════                                                   │
│  Input:  articles[stage='fetched']                                       │
│  Output: articles z {content_raw}                                        │
│  Status: 'raw', stage: 'content_extracted'                               │
│  Storage: articles table (update)                                        │
│                                                                         │
│         ↓                                                                │
│                                                                         │
│  STAGE 3: PROCESS (AI)                                                   │
│  ════════════════════════                                                │
│  Input:  articles[stage='content_extracted']                             │
│  Model:  qwen2.5:7b (konfigurowalne)                                     │
│  Output: articles z {content_processed}                                  │
│  Status: 'processed', stage: 'ai_processed'                              │
│  Retry:  automatyczne do 3 prób                                          │
│                                                                         │
│         ↓                                                                │
│                                                                         │
│  STAGE 4: PREPARE                                                        │
│  ═════════════                                                           │
│  Input:  articles[stage='ai_processed']                                  │
│  Output: articles z {content_ready}                                      │
│  Status: 'ready', stage: 'ready'                                         │
│  Cleanup: usunięcie reklam, linków, formatowanie                         │
│                                                                         │
│         ↓                                                                │
│                                                                         │
│  STAGE 5: PUBLISH                                                        │
│  ═════════════                                                           │
│  Input:  articles[stage='ready']                                         │
│  Output: wp_post_id, published_at                                        │
│  Storage: przeniesienie do published_articles                            │
│  Cleanup: usunięcie z articles table                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. NUMERACJA I RETRY

### Format identyfikatora

```
{article_number}[-{retry_count}]

Przykłady:
- art-1           → artykuł #1, pierwsza próba
- art-999         → artykuł #999, pierwsza próba
- art-5-2         → artykuł #5, retry #2
- art-32-01       → artykuł #32, retry #1
```

### Automatyczny retry (max 3 próby)

```javascript
const MAX_RETRIES = 3;
```

---

## 8. STATYSTYKI

### Format `stats-articles`

```
╔══════════════════════════════════════════════════════════════════════╗
║                    RC POSTY - STATYSTYKI ARTYKUŁÓW                   ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  📥 RAW (pobrane):                    5 / 5 (MAX)                   ║
║     Artykuły: art-1, art-2, art-3, art-4, art-5                     ║
║     Wiek: najstarszy 4 dni                                         ║
║                                                                      ║
║  ⚙️  PROCESSED (przetworzone AI):    3 / 5                           ║
║     Artykuły: art-6, art-7, art-8                                   ║
║     Wiek: najstarszy 2 dni                                          ║
║                                                                      ║
║  ✅ READY (gotowe do publikacji):   2 / 5                           ║
║     Artykuły: art-11, art-12                                       ║
║     Wiek: najstarszy 1 dzień                                        ║
║                                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  📤 PUBLISHED:                      15  (aktywne)                    ║
║     W archiwum:                     12                               ║
║     Ostatnie 7 dni:                  8                               ║
║                                                                      ║
║  ❌ BŁĘDY:                           2                               ║
║     art-9  (AI timeout,      retry: 1/3)                            ║
║     art-10 (content empty,   retry: 1/3)                            ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 9. ŹRÓDŁA WYSZUKIWANIA

### Aktywne źródła (config/default.json)

```json
{
  "search": {
    "sources": ["rss", "duckduckgo", "bing", "yahoo"]
  },
  "rss": {
    "googleNews": true,
    "customFeeds": [
      "https://www.wirtualnemedia.pl/rss",
      "https://businessinsider.com.pl/rss/wiadomosci",
      "https://www.pb.pl/rss"
    ]
  }
}
```

### Dostępne źródła

| Source | Typ | Opis |
|--------|-----|------|
| `rss` | RSS | Google News RSS + custom feeds |
| `duckduckgo` | Web | DuckDuckGo HTML search |
| `bing` | Web | Bing search |
| `yahoo` | Web | Yahoo search |
| `startpage` | Web | Startpage search (opcjonalne) |
| `yandex` | Web | Yandex search (opcjonalne) |

---

## 10. KONFIGURACJA

### config/default.json

```json
{
  "keywords": ["szkolenia sprzedażowe", "kompetencje miękkie", "rozwój zespołu"],

  "search": {
    "sources": ["rss", "duckduckgo", "bing", "yahoo"],
    "maxResults": 10,
    "maxAgeDays": 7
  },

  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "qwen2.5:7b",
    "timeout": 120000
  },

  "cleanup": {
    "enabled": true,
    "intervalHours": 24,
    "rawMaxAgeDays": 4,
    "processedMaxAgeDays": 4,
    "readyMaxAgeDays": 4,
    "publishedArchiveDays": 90,
    "maxArticlesPerStatus": {
      "raw": 5,
      "processed": 5,
      "ready": 5
    }
  },

  "retry": {
    "enabled": true,
    "maxAttempts": 3,
    "backoffMultiplier": 2,
    "initialDelayMs": 1000
  }
}
```

---

## 11. QUICK REFERENCE

```bash
# SZYBKIE POLECENIA
node src/index.js fetch              # Pobierz
node src/index.js fetch-full         # Pobierz treść
node src/index.js process            # Przetwórz AI
node src/index.js prepare            # Oczyść
node src/index.js publish-ready      # Publikuj
node src/index.js workflow --full    # WSZYSTKO
node src/index.js stats-articles     # Statystyki
node src/index.js errors             # Błędy
node src/index.js db cleanup         # Czyszczenie
```

---

## 12. PLIKI PROJEKTU

```
rcposty/
├── src/
│   ├── index.js              (główne CLI - nowe komendy)
│   ├── rc-agent.js           (główny agent)
│   ├── database.js           (nowa struktura, cleanup, archive)
│   ├── rss-fetcher.js        (bez zmian)
│   ├── article-source.js     (rozszerzone źródła wyszukiwania)
│   ├── ollama-client.js      (processArticle method)
│   └── utils/
├── data/
│   ├── articles.db           (baza z nową strukturą)
│   └── stats.json
├── config/
│   └── default.json          (aktualizacja konfiguracji)
├── AGENT_WORKFLOW.md         (ta dokumentacja)
└── README.md
```

---

## 13. MODEL AI - QWEN2.5:7B

### Rekomendowany model

| Parametr | Wartość |
|----------|---------|
| Model | `qwen2.5:7b` |
| Rozmiar | ~5 GB |
| Jakość | Bardzo dobra |
| Szybkość | Szybki |

### Instalacja modelu

```bash
ollama pull qwen2.5:7b
```

### Alternatywne modele

```bash
ollama pull llama3.2:3b    # Szybszy, mniejsza jakość
ollama pull mistral:7b     # Dobry balans
ollama pull gemma2:9b      # Wysoka jakość
```

---

*Ostatnia aktualizacja: 2026-01-31*
