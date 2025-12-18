#!/usr/bin/env node
import * as path from 'path';
import { SignalDatabase } from './database.js';

const dataDir = './data';

class StatsViewer {
  private db: SignalDatabase;

  constructor() {
    this.db = new SignalDatabase(path.join(dataDir, 'signals.db'));
  }

  show(): void {
    console.log('\n=== CallSofia Database Statistics ===\n');

    const stats = this.db.getStatistics();
    const progress = this.db.getProgress();

    // Overall stats
    console.log('--- Overall ---');
    console.log(`Total signals in database: ${stats.totalSignals.toLocaleString()}`);
    console.log(`Last scraped ID: ${progress.lastScrapedId.toLocaleString()}`);
    console.log(`Total scraped: ${progress.totalScraped.toLocaleString()}`);
    console.log(`Total errors: ${progress.totalErrors.toLocaleString()}`);
    console.log(`Started: ${progress.startedAt}`);
    console.log(`Last updated: ${progress.lastUpdatedAt}`);

    // By category
    console.log('\n--- By Category ---');
    const topCategories = stats.byCategory.slice(0, 10);
    for (const cat of topCategories) {
      console.log(`  ${cat.categoryName || 'Unknown'}: ${cat.count.toLocaleString()}`);
    }

    // By subcategory (top 15)
    console.log('\n--- Top 15 Subcategories ---');
    const topSubcategories = stats.bySubcategory.slice(0, 15);
    for (const subcat of topSubcategories) {
      console.log(`  [${subcat.subcategoryId}] ${subcat.subcategoryName || 'Unknown'}: ${subcat.count.toLocaleString()}`);
    }

    // Bicycle infrastructure specifically
    const bicycleStats = stats.bySubcategory.find(s => s.subcategoryId === 30271);
    if (bicycleStats) {
      console.log('\n--- Bicycle Infrastructure (ID: 30271) ---');
      console.log(`  Total signals: ${bicycleStats.count.toLocaleString()}`);
    }

    // By district
    console.log('\n--- Top 10 Districts ---');
    const topDistricts = stats.byDistrict.slice(0, 10);
    for (const dist of topDistricts) {
      console.log(`  ${dist.district || 'Unknown'}: ${dist.count.toLocaleString()}`);
    }

    // By status
    console.log('\n--- By Status ---');
    for (const st of stats.byStatus) {
      console.log(`  ${st.status || 'Unknown'}: ${st.count.toLocaleString()}`);
    }

    // By year
    console.log('\n--- By Year ---');
    for (const yr of stats.byYear) {
      if (yr.year && yr.year.length === 4) {
        console.log(`  ${yr.year}: ${yr.count.toLocaleString()}`);
      }
    }

    console.log('\n');
  }

  close(): void {
    this.db.close();
  }
}

const viewer = new StatsViewer();
viewer.show();
viewer.close();
