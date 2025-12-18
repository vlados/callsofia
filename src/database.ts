import Database from 'better-sqlite3';
import type {
  Signal,
  StatusHistoryEntry,
  ClerkAnswer,
  Category,
  Subcategory,
  ScrapeProgress,
} from './types.js';

export class SignalDatabase {
  private db: Database.Database;

  constructor(dbPath: string = './data/signals.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      -- Main signals table
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY,
        registration_number TEXT,
        registration_date TEXT,
        category_id INTEGER,
        category_name TEXT,
        subcategory_id INTEGER,
        subcategory_name TEXT,
        status TEXT,
        status_date TEXT,
        district TEXT,
        neighborhood TEXT,
        address TEXT,
        latitude REAL,
        longitude REAL,
        description TEXT,
        problem_location TEXT,
        has_documents INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        raw_html TEXT
      );

      -- Status history table
      CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        FOREIGN KEY (signal_id) REFERENCES signals(id)
      );

      -- Clerk answers table
      CREATE TABLE IF NOT EXISTS clerk_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER NOT NULL,
        registration_number TEXT,
        date TEXT,
        content TEXT,
        institution TEXT,
        FOREIGN KEY (signal_id) REFERENCES signals(id)
      );

      -- Categories lookup table
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER
      );

      -- Subcategories lookup table
      CREATE TABLE IF NOT EXISTS subcategories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        full_name TEXT NOT NULL,
        parent_category_id INTEGER NOT NULL
      );

      -- Scrape progress tracking
      CREATE TABLE IF NOT EXISTS scrape_progress (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_scraped_id INTEGER DEFAULT 0,
        total_scraped INTEGER DEFAULT 0,
        total_errors INTEGER DEFAULT 0,
        started_at TEXT,
        last_updated_at TEXT
      );

      -- Scrape errors log
      CREATE TABLE IF NOT EXISTS scrape_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER NOT NULL,
        error_message TEXT,
        error_type TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes for faster queries
      CREATE INDEX IF NOT EXISTS idx_signals_category ON signals(category_id);
      CREATE INDEX IF NOT EXISTS idx_signals_subcategory ON signals(subcategory_id);
      CREATE INDEX IF NOT EXISTS idx_signals_district ON signals(district);
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
      CREATE INDEX IF NOT EXISTS idx_signals_registration_date ON signals(registration_date);
      CREATE INDEX IF NOT EXISTS idx_status_history_signal ON status_history(signal_id);
      CREATE INDEX IF NOT EXISTS idx_clerk_answers_signal ON clerk_answers(signal_id);

      -- Initialize progress if not exists
      INSERT OR IGNORE INTO scrape_progress (id, started_at, last_updated_at)
      VALUES (1, datetime('now'), datetime('now'));
    `);
  }

  // Signal operations
  upsertSignal(signal: Signal): void {
    const stmt = this.db.prepare(`
      INSERT INTO signals (
        id, registration_number, registration_date, category_id, category_name,
        subcategory_id, subcategory_name, status, status_date, district,
        neighborhood, address, latitude, longitude, description,
        problem_location, has_documents, updated_at, raw_html
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?
      )
      ON CONFLICT(id) DO UPDATE SET
        registration_number = excluded.registration_number,
        registration_date = excluded.registration_date,
        category_id = excluded.category_id,
        category_name = excluded.category_name,
        subcategory_id = excluded.subcategory_id,
        subcategory_name = excluded.subcategory_name,
        status = excluded.status,
        status_date = excluded.status_date,
        district = excluded.district,
        neighborhood = excluded.neighborhood,
        address = excluded.address,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        description = excluded.description,
        problem_location = excluded.problem_location,
        has_documents = excluded.has_documents,
        updated_at = datetime('now'),
        raw_html = COALESCE(excluded.raw_html, raw_html)
    `);

    stmt.run(
      signal.id,
      signal.registrationNumber,
      signal.registrationDate,
      signal.categoryId,
      signal.categoryName,
      signal.subcategoryId,
      signal.subcategoryName,
      signal.status,
      signal.statusDate,
      signal.district,
      signal.neighborhood,
      signal.address,
      signal.latitude,
      signal.longitude,
      signal.description,
      signal.problemLocation,
      signal.hasDocuments ? 1 : 0,
      signal.rawHtml
    );
  }

  upsertSignals(signals: Signal[]): void {
    const transaction = this.db.transaction((signals: Signal[]) => {
      for (const signal of signals) {
        this.upsertSignal(signal);
      }
    });
    transaction(signals);
  }

  getSignal(id: number): Signal | null {
    const row = this.db.prepare('SELECT * FROM signals WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToSignal(row);
  }

  signalExists(id: number): boolean {
    const row = this.db.prepare('SELECT 1 FROM signals WHERE id = ?').get(id);
    return !!row;
  }

  // Status history operations
  insertStatusHistory(entries: StatusHistoryEntry[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO status_history (signal_id, status, date, note)
      VALUES (?, ?, ?, ?)
    `);

    const deleteStmt = this.db.prepare('DELETE FROM status_history WHERE signal_id = ?');

    const transaction = this.db.transaction((entries: StatusHistoryEntry[]) => {
      if (entries.length > 0) {
        deleteStmt.run(entries[0].signalId);
        for (const entry of entries) {
          stmt.run(entry.signalId, entry.status, entry.date, entry.note);
        }
      }
    });
    transaction(entries);
  }

  getStatusHistory(signalId: number): StatusHistoryEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM status_history WHERE signal_id = ? ORDER BY date DESC'
    ).all(signalId) as any[];

    return rows.map(row => ({
      signalId: row.signal_id,
      status: row.status,
      date: row.date,
      note: row.note,
    }));
  }

  // Clerk answers operations
  insertClerkAnswers(answers: ClerkAnswer[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO clerk_answers (signal_id, registration_number, date, content, institution)
      VALUES (?, ?, ?, ?, ?)
    `);

    const deleteStmt = this.db.prepare('DELETE FROM clerk_answers WHERE signal_id = ?');

    const transaction = this.db.transaction((answers: ClerkAnswer[]) => {
      if (answers.length > 0) {
        deleteStmt.run(answers[0].signalId);
        for (const answer of answers) {
          stmt.run(
            answer.signalId,
            answer.registrationNumber,
            answer.date,
            answer.content,
            answer.institution
          );
        }
      }
    });
    transaction(answers);
  }

  getClerkAnswers(signalId: number): ClerkAnswer[] {
    const rows = this.db.prepare(
      'SELECT * FROM clerk_answers WHERE signal_id = ? ORDER BY date DESC'
    ).all(signalId) as any[];

    return rows.map(row => ({
      signalId: row.signal_id,
      registrationNumber: row.registration_number,
      date: row.date,
      content: row.content,
      institution: row.institution,
    }));
  }

  // Category operations
  upsertCategories(categories: Category[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO categories (id, name, parent_id)
      VALUES (?, ?, ?)
    `);

    const transaction = this.db.transaction((categories: Category[]) => {
      for (const cat of categories) {
        stmt.run(cat.id, cat.name, cat.parentId);
      }
    });
    transaction(categories);
  }

  upsertSubcategories(subcategories: Subcategory[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO subcategories (id, name, full_name, parent_category_id)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((subcategories: Subcategory[]) => {
      for (const subcat of subcategories) {
        stmt.run(subcat.id, subcat.name, subcat.fullName, subcat.parentCategoryId);
      }
    });
    transaction(subcategories);
  }

  // Lookup category ID by name
  getCategoryIdByName(name: string): number | null {
    const row = this.db.prepare(
      'SELECT id FROM categories WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    return row?.id || null;
  }

  // Lookup subcategory ID by name
  getSubcategoryIdByName(name: string): number | null {
    const row = this.db.prepare(
      'SELECT id FROM subcategories WHERE name = ?'
    ).get(name) as { id: number } | undefined;
    return row?.id || null;
  }

  // Lookup both category and subcategory IDs by names
  lookupCategoryIds(categoryName: string | null, subcategoryName: string | null): {
    categoryId: number | null;
    subcategoryId: number | null;
  } {
    let categoryId: number | null = null;
    let subcategoryId: number | null = null;

    if (categoryName) {
      categoryId = this.getCategoryIdByName(categoryName);
    }

    if (subcategoryName) {
      subcategoryId = this.getSubcategoryIdByName(subcategoryName);
      // If we found subcategory but not category, get category from subcategory
      if (subcategoryId && !categoryId) {
        const row = this.db.prepare(
          'SELECT parent_category_id FROM subcategories WHERE id = ?'
        ).get(subcategoryId) as { parent_category_id: number } | undefined;
        categoryId = row?.parent_category_id || null;
      }
    }

    return { categoryId, subcategoryId };
  }

  // Progress tracking
  getProgress(): ScrapeProgress {
    const row = this.db.prepare('SELECT * FROM scrape_progress WHERE id = 1').get() as any;
    return {
      lastScrapedId: row.last_scraped_id,
      totalScraped: row.total_scraped,
      totalErrors: row.total_errors,
      startedAt: row.started_at,
      lastUpdatedAt: row.last_updated_at,
    };
  }

  updateProgress(lastId: number, incrementScraped: number = 1, incrementErrors: number = 0): void {
    this.db.prepare(`
      UPDATE scrape_progress
      SET last_scraped_id = MAX(last_scraped_id, ?),
          total_scraped = total_scraped + ?,
          total_errors = total_errors + ?,
          last_updated_at = datetime('now')
      WHERE id = 1
    `).run(lastId, incrementScraped, incrementErrors);
  }

  resetProgress(): void {
    this.db.prepare(`
      UPDATE scrape_progress
      SET last_scraped_id = 0,
          total_scraped = 0,
          total_errors = 0,
          started_at = datetime('now'),
          last_updated_at = datetime('now')
      WHERE id = 1
    `).run();
  }

  // Error logging
  logError(signalId: number, message: string, type: string = 'unknown'): void {
    this.db.prepare(`
      INSERT INTO scrape_errors (signal_id, error_message, error_type)
      VALUES (?, ?, ?)
    `).run(signalId, message, type);
  }

  // Query operations for export and analysis
  getSignalsBySubcategory(subcategoryId: number): Signal[] {
    const rows = this.db.prepare(
      'SELECT * FROM signals WHERE subcategory_id = ? ORDER BY registration_date DESC'
    ).all(subcategoryId) as any[];
    return rows.map(this.rowToSignal);
  }

  getSignalsByCategory(categoryId: number): Signal[] {
    const rows = this.db.prepare(
      'SELECT * FROM signals WHERE category_id = ? ORDER BY registration_date DESC'
    ).all(categoryId) as any[];
    return rows.map(this.rowToSignal);
  }

  getSignalsByDistrict(district: string): Signal[] {
    const rows = this.db.prepare(
      'SELECT * FROM signals WHERE district = ? ORDER BY registration_date DESC'
    ).all(district) as any[];
    return rows.map(this.rowToSignal);
  }

  getSignalsByDateRange(startDate: string, endDate: string): Signal[] {
    const rows = this.db.prepare(
      'SELECT * FROM signals WHERE registration_date BETWEEN ? AND ? ORDER BY registration_date DESC'
    ).all(startDate, endDate) as any[];
    return rows.map(this.rowToSignal);
  }

  getAllSignals(): Signal[] {
    const rows = this.db.prepare('SELECT * FROM signals ORDER BY id').all() as any[];
    return rows.map(this.rowToSignal);
  }

  getSignalCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM signals').get() as any;
    return row.count;
  }

  getStatistics(): {
    totalSignals: number;
    byCategory: { categoryId: number; categoryName: string; count: number }[];
    bySubcategory: { subcategoryId: number; subcategoryName: string; count: number }[];
    byDistrict: { district: string; count: number }[];
    byStatus: { status: string; count: number }[];
    byYear: { year: string; count: number }[];
  } {
    const totalSignals = this.getSignalCount();

    const byCategory = this.db.prepare(`
      SELECT category_id as categoryId, category_name as categoryName, COUNT(*) as count
      FROM signals
      WHERE category_name IS NOT NULL AND category_name != ''
      GROUP BY category_name
      ORDER BY count DESC
    `).all() as any[];

    const bySubcategory = this.db.prepare(`
      SELECT subcategory_id as subcategoryId, subcategory_name as subcategoryName, COUNT(*) as count
      FROM signals
      WHERE subcategory_name IS NOT NULL AND subcategory_name != ''
      GROUP BY subcategory_name
      ORDER BY count DESC
    `).all() as any[];

    const byDistrict = this.db.prepare(`
      SELECT district, COUNT(*) as count
      FROM signals
      WHERE district IS NOT NULL AND district != ''
      GROUP BY district
      ORDER BY count DESC
    `).all() as any[];

    const byStatus = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM signals
      WHERE status IS NOT NULL
      GROUP BY status
      ORDER BY count DESC
    `).all() as any[];

    const byYear = this.db.prepare(`
      SELECT substr(registration_date, 7, 4) as year, COUNT(*) as count
      FROM signals
      WHERE registration_date IS NOT NULL
      GROUP BY year
      ORDER BY year
    `).all() as any[];

    return { totalSignals, byCategory, bySubcategory, byDistrict, byStatus, byYear };
  }

  // Get missing IDs in a range (for resuming scrape)
  getMissingIds(start: number, end: number): number[] {
    const existingIds = new Set(
      (this.db.prepare(
        'SELECT id FROM signals WHERE id BETWEEN ? AND ?'
      ).all(start, end) as any[]).map(row => row.id)
    );

    const missing: number[] = [];
    for (let i = start; i <= end; i++) {
      if (!existingIds.has(i)) {
        missing.push(i);
      }
    }
    return missing;
  }

  private rowToSignal(row: any): Signal {
    return {
      id: row.id,
      registrationNumber: row.registration_number,
      registrationDate: row.registration_date,
      categoryId: row.category_id,
      categoryName: row.category_name,
      subcategoryId: row.subcategory_id,
      subcategoryName: row.subcategory_name,
      status: row.status,
      statusDate: row.status_date,
      district: row.district,
      neighborhood: row.neighborhood,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      description: row.description,
      problemLocation: row.problem_location,
      hasDocuments: !!row.has_documents,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rawHtml: row.raw_html,
    };
  }

  close(): void {
    this.db.close();
  }
}
