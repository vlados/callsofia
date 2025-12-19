# Development Guide

Technical documentation for developing and maintaining the CallSofia scraper.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      call.sofia.bg                          │
│                    (ASP.NET MVC Backend)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    CallSofiaClient                          │
│  - Authentication (cookies)                                 │
│  - HTTP requests with retry logic                           │
│  - Rate limiting                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SignalParser                             │
│  - HTML parsing with Cheerio                                │
│  - Data extraction from Bootstrap forms                     │
│  - Coordinate extraction                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SignalDatabase                            │
│  - SQLite with better-sqlite3                               │
│  - WAL mode for performance                                 │
│  - Upsert operations                                        │
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

The call.sofia.bg website uses these endpoints:

### Signal Details (HTML)
```
GET /bg/Signal/Details/{id}
```
Returns full HTML page with signal details. Public access.

### Status History (JSON)
```
POST /bg/Status/IndexJson/{signalId}
Content-Type: application/x-www-form-urlencoded
Body: page=1&rows=100
```

Response format:
```json
{
  "total": 1,
  "page": 1,
  "records": 5,
  "rows": [
    {
      "TimestampFrom": "/Date(1629980643646)/",
      "TimestampTo": "/Date(1629980700000)/",
      "Username": null,
      "Reason": "Приключен. Направена проверка.",
      "Change": "Приключен"
    }
  ]
}
```

Note: Timestamps are in Unix milliseconds format: `/Date(MILLISECONDS)/`

### Clerk Answers (JSON)
```
POST /bg/ClerkAnswer/IndexJson/{signalId}
Content-Type: application/x-www-form-urlencoded
Body: page=1&rows=100
```

### Categories
```
GET /bg/Signal/GetCategory
```
Returns all main categories.

### Subcategories
```
GET /bg/Signal/GetCategoryScript
```
Returns all subcategories with parent mappings.

## HTML Structure

Signal detail pages use Bootstrap grid layout:

```html
<!-- Header -->
<h3>Сигнал №{id}/ {regNumber}/ {date}</h3>
<h4>Category / <i>Subcategory</i></h4>

<!-- Status -->
<p id="statusIndicator" class="status_indicator">Status Text</p>

<!-- Location fields -->
<div class="row">
  <label>Район</label>
  <div class="col-md-10">район Младост</div>
</div>

<!-- Coordinates in page or scripts -->
<div>Местоположение [42.123456,23.654321]</div>

<!-- Description in og:description meta tag -->
<meta property="og:description" content="Problem description">
```

## Parser Implementation

### Key Extraction Methods

1. **Header parsing** (`src/parser.ts:16-32`)
   - Registration number: regex `/(СО[А]?\d{2}-КЦ\d{0,2}-?\d+)/`
   - Date: regex `/(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})/`

2. **Category extraction** (`src/parser.ts:39-74`)
   - From `<h4>` element after header
   - Split by `/` for category/subcategory

3. **Location extraction** (`src/parser.ts:165-222`)
   - Uses `extractRowValue()` to find Bootstrap form fields
   - Looks for labels like "Район", "ж.к.", "Приблизителен адрес"

4. **Coordinates** (`src/parser.ts:87-110`)
   - First from location text: `[lat,lng]` format
   - Fallback: search in scripts for `[4x.xxxxx,2x.xxxxx]`

## Known Issues & Fixes

### Issue 1: Garbage data in neighborhood/problemLocation fields
**Problem:** The `extractRowValue()` function was too greedy and matched entire page content when searching for labels.

**Root cause:** The fallback logic checked if any `.row` div's text included the label, but this matched rows containing the label anywhere (including in scripts).

**Fix:** (Applied 2025-12-19)
1. Added label text validation - must start with search term
2. Added max length check (1000 chars) for returned values
3. Changed `.row` matching to only check actual `<label>` elements

**Cleanup SQL:**
```sql
UPDATE signals SET neighborhood = NULL WHERE LENGTH(neighborhood) > 500;
UPDATE signals SET problem_location = NULL WHERE LENGTH(problem_location) > 500;
```

### Issue 2: Category/Subcategory IDs not populated
**Problem:** Signals had category names but no IDs.

**Fix:** Added `lookupCategoryIds()` method in database.ts that matches names to IDs from the categories/subcategories tables.

**Cleanup SQL:**
```sql
UPDATE signals
SET subcategory_id = (
  SELECT id FROM subcategories
  WHERE subcategories.name = signals.subcategory_name
)
WHERE subcategory_id IS NULL AND subcategory_name IS NOT NULL;
```

### Issue 3: Status history API returns different format
**Problem:** Client expected `row.cell` array but API returns object properties.

**Status:** The `getStatusHistory()` method in client.ts may need updating. Current workaround is to call the API directly for status history analysis.

## Database Schema Details

### signals table
```sql
CREATE TABLE signals (
  id INTEGER PRIMARY KEY,
  registration_number TEXT,
  registration_date TEXT,        -- Format: DD.MM.YYYY HH:MM:SS
  category_id INTEGER,
  category_name TEXT,
  subcategory_id INTEGER,
  subcategory_name TEXT,
  status TEXT,
  status_date TEXT,
  district TEXT,                 -- e.g., "район Младост"
  neighborhood TEXT,             -- e.g., "ж.к. Младост 3"
  address TEXT,
  latitude REAL,
  longitude REAL,
  description TEXT,
  problem_location TEXT,
  has_documents INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  raw_html TEXT                  -- Only if --save-html used
);

-- Indexes
CREATE INDEX idx_signals_category ON signals(category_id);
CREATE INDEX idx_signals_subcategory ON signals(subcategory_id);
CREATE INDEX idx_signals_district ON signals(district);
CREATE INDEX idx_signals_status ON signals(status);
CREATE INDEX idx_signals_registration_date ON signals(registration_date);
```

### categories table
```sql
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER
);
```

### subcategories table
```sql
CREATE TABLE subcategories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,       -- "Category-Subcategory"
  parent_category_id INTEGER NOT NULL
);
```

### status_history table
```sql
CREATE TABLE status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  FOREIGN KEY (signal_id) REFERENCES signals(id)
);
```

## Testing

### Manual testing
```bash
# Test single signal scrape
npm run scrape -- --start 536304 --end 536304

# Check result
sqlite3 data/signals.db "SELECT * FROM signals WHERE id = 536304;"
```

### Verify data quality
```bash
# Check for garbage data
sqlite3 data/signals.db "
SELECT COUNT(*) FROM signals WHERE LENGTH(neighborhood) > 500;
SELECT COUNT(*) FROM signals WHERE LENGTH(problem_location) > 500;
"

# Check category coverage
sqlite3 data/signals.db "
SELECT
  COUNT(*) as total,
  SUM(CASE WHEN category_id IS NOT NULL THEN 1 ELSE 0 END) as with_category,
  SUM(CASE WHEN subcategory_id IS NOT NULL THEN 1 ELSE 0 END) as with_subcategory
FROM signals;
"
```

## Performance Tips

1. **Use `--skip-existing`** when re-running to avoid duplicates
2. **Increase concurrency** for faster scraping (max ~20 recommended)
3. **Use WAL mode** (already enabled by default)
4. **Batch operations** for database writes

## Cookie Refresh

Cookies expire periodically. To refresh:

1. Open https://call.sofia.bg/ in browser
2. Log in
3. Open DevTools → Application → Cookies
4. Copy new values to `.env`
5. Test with `npm run test-connection`

## Future Improvements

- [ ] Fix `getStatusHistory()` to handle current API response format
- [ ] Add GeoJSON export for mapping
- [ ] Add automatic cookie refresh mechanism
- [ ] Add unit tests for parser
- [ ] Add progress estimation based on ID ranges
- [ ] Implement incremental updates (only scrape new signals)

## Useful Commands

```bash
# Database size
ls -lh data/signals.db

# Record count
sqlite3 data/signals.db "SELECT COUNT(*) FROM signals;"

# Latest signal date
sqlite3 data/signals.db "SELECT MAX(registration_date) FROM signals;"

# Disk usage by table
sqlite3 data/signals.db "
SELECT name, SUM(pgsize) as size
FROM dbstat
GROUP BY name
ORDER BY size DESC;
"

# Export specific query to CSV
sqlite3 -header -csv data/signals.db "
SELECT id, registration_date, district, status, description
FROM signals
WHERE subcategory_id = 30271
" > bicycle_signals.csv
```

## Contact

Project maintained as part of bicycle infrastructure analysis for Sofia, Bulgaria.
