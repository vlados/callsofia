# CallSofia Scraper

A scraper for collecting public signals data from [call.sofia.bg](https://call.sofia.bg/) - Sofia Municipality's public complaint and issue reporting system.

## Features

- Scrapes all public signals (currently ~676,000+ signals from 2014-present)
- Stores data in SQLite for efficient querying
- Supports filtering by category, subcategory, district, status, and date range
- Exports to JSON or CSV formats
- Resumable scraping with progress tracking
- Rate limiting and retry logic to avoid overloading the server
- Concurrent requests with configurable parallelism

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure authentication

Copy `.env.example` to `.env` and add your cookies:

```bash
cp .env.example .env
```

To get the cookies:
1. Go to https://call.sofia.bg/
2. Log in with your account
3. Open DevTools (F12) → Application → Cookies
4. Copy the values for:
   - `.ASPXAUTH` → `ASPX_AUTH`
   - `__RequestVerificationToken` → `REQUEST_VERIFICATION_TOKEN`
   - `TS019ad0ce` → `SESSION_TOKEN` (optional)

### 3. Test connection

```bash
npm run test-connection
```

### 4. Start scraping

```bash
# Scrape signals 1-1000 (for testing)
npm run scrape:range

# Scrape all signals (1 to 680,000)
npm run scrape

# Resume from last position
npm run scrape -- --resume

# Custom range with options
npm run scrape -- --start 100000 --end 200000 --concurrency 10 --delay 100

# Skip already scraped IDs
npm run scrape -- --start 1 --end 100000 --skip-existing
```

### 5. Export data

```bash
# Export all signals to JSON
npm run export

# Export only bicycle infrastructure signals
npm run export -- --subcategory 30271 --format json

# Export with filters
npm run export -- --district "Младост" --format json
npm run export -- --start-date 2023-01-01 --end-date 2023-12-31
```

### 6. View statistics

```bash
npm run stats
```

## Project Structure

```
callsofia/
├── src/
│   ├── client.ts      # HTTP client with authentication
│   ├── database.ts    # SQLite database operations
│   ├── parser.ts      # HTML parsing logic
│   ├── scraper.ts     # Main scraper CLI
│   ├── export.ts      # Data export CLI
│   ├── stats.ts       # Statistics CLI
│   └── types.ts       # TypeScript interfaces
├── data/
│   └── signals.db     # SQLite database (created on first run)
├── exports/           # Exported data files
├── .env               # Authentication cookies (not committed)
├── .env.example       # Example environment file
└── package.json
```

## Category IDs

### Main Categories

| ID | Name (Bulgarian) | Name (English) |
|----|------------------|----------------|
| 3 | Пътна инфраструктура | Road Infrastructure |
| 27 | Сметосъбиране и сметоизвозване | Waste Collection |
| 28 | Улично осветление | Street Lighting |
| 5 | Паркиране | Parking |
| 6 | Екология. Зелена система | Ecology & Green System |
| 4 | Пътна сигнализация | Traffic Signals |
| 30 | Замърсяване на обществени площи | Public Area Contamination |
| 38 | Масов градски транспорт | Public Transport |
| 2 | Водоснабдяване и канализация | Water Supply & Sewerage |
| 9 | Сгради/строежи | Buildings/Construction |

### Bicycle Infrastructure

**Subcategory ID: `30271`**

- Full name: "Пътна инфраструктура-Проблеми с велосипедната инфраструктура (изграждане и поддръжка на велоалеи)"
- Translation: "Road Infrastructure - Problems with bicycle infrastructure (construction and maintenance of bike lanes)"
- Parent Category: 3 (Road Infrastructure)

## CLI Options

### Scraper (`npm run scrape`)

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --start <n>` | 1 | Start signal ID |
| `-e, --end <n>` | 680000 | End signal ID |
| `-c, --concurrency <n>` | 5 | Concurrent requests |
| `-d, --delay <n>` | 200 | Delay between requests (ms) |
| `-r, --resume` | false | Resume from last scraped ID |
| `--skip-existing` | false | Skip IDs already in database |
| `--save-html` | false | Save raw HTML to database |
| `--fetch-extras` | false | Also fetch status history and clerk answers |
| `-b, --batch-size <n>` | 100 | Batch size for processing |

### Export (`npm run export`)

| Option | Description |
|--------|-------------|
| `-f, --format <fmt>` | Export format: json, csv, or sqlite |
| `-c, --category <id>` | Filter by category ID |
| `-s, --subcategory <id>` | Filter by subcategory ID |
| `--district <name>` | Filter by district name |
| `--status <status>` | Filter by status |
| `--start-date <date>` | Filter by start date (YYYY-MM-DD) |
| `--end-date <date>` | Filter by end date (YYYY-MM-DD) |
| `--include-history` | Include status history |
| `--include-answers` | Include clerk answers |

## Data Structure

Each signal contains:

| Field | Type | Description |
|-------|------|-------------|
| id | number | Signal ID (auto-increment) |
| registrationNumber | string | Official registration number (e.g., СОА24-КЦ01-85321) |
| registrationDate | string | Date/time of registration |
| categoryId | number | Main category ID |
| categoryName | string | Category name |
| subcategoryId | number | Subcategory ID |
| subcategoryName | string | Subcategory name |
| status | string | Current status |
| district | string | District name (e.g., "район Младост") |
| neighborhood | string | Neighborhood/quarter (e.g., "ж.к. Младост 3") |
| address | string | Street address |
| latitude | number | GPS latitude |
| longitude | number | GPS longitude |
| description | string | Problem description |
| problemLocation | string | Location type |
| hasDocuments | boolean | Has attached documents |

## Database Schema

The SQLite database (`data/signals.db`) contains:

- `signals` - Main signals table
- `status_history` - Status change history (requires `--fetch-extras`)
- `clerk_answers` - Official responses (requires `--fetch-extras`)
- `categories` - Category lookup table (18 categories)
- `subcategories` - Subcategory lookup table (97 subcategories)
- `scrape_progress` - Progress tracking
- `scrape_errors` - Error log

## Useful SQL Queries

```sql
-- Count signals by category
SELECT category_name, COUNT(*) as count
FROM signals
GROUP BY category_name
ORDER BY count DESC;

-- Find bicycle infrastructure signals
SELECT * FROM signals WHERE subcategory_id = 30271;

-- Signals by district
SELECT district, COUNT(*) as count
FROM signals
WHERE district IS NOT NULL
GROUP BY district
ORDER BY count DESC;

-- Signals by year
SELECT substr(registration_date, 7, 4) as year, COUNT(*) as count
FROM signals
GROUP BY year
ORDER BY year;

-- Resolution rate by status
SELECT status, COUNT(*) as count,
       ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM signals), 2) as pct
FROM signals
GROUP BY status
ORDER BY count DESC;
```

## Notes

- The scraper respects rate limits with configurable delays
- Cookies may expire; you'll need to refresh them periodically
- Signal IDs are sequential but some may be missing (deleted or never created)
- All dates in the database are in Bulgarian format (DD.MM.YYYY HH:MM:SS)
- The bicycle infrastructure category was added around June 2021

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for technical details, API documentation, and known issues.

## Reports

Analysis reports are available in the `exports/` directory:
- `bicycle_infrastructure_report_bg.md` - Full analysis in Bulgarian

## License

MIT
