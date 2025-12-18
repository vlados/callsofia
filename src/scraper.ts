#!/usr/bin/env node
import { Command } from 'commander';
import cliProgress from 'cli-progress';
import pLimit from 'p-limit';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CallSofiaClient } from './client.js';
import { SignalDatabase } from './database.js';
import { SignalParser } from './parser.js';
import type { ScraperConfig, Signal } from './types.js';

dotenv.config();

// Ensure data directory exists
const dataDir = './data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

interface ScrapeOptions {
  start: number;
  end: number;
  concurrency: number;
  delay: number;
  resume: boolean;
  saveHtml: boolean;
  skipExisting: boolean;
  fetchExtras: boolean;
  batchSize: number;
}

class Scraper {
  private client: CallSofiaClient;
  private db: SignalDatabase;
  private parser: SignalParser;
  private progressBar: cliProgress.SingleBar;
  private options: ScrapeOptions;
  private stats = {
    scraped: 0,
    skipped: 0,
    errors: 0,
    notFound: 0,
  };

  constructor(config: Partial<ScraperConfig>, options: ScrapeOptions) {
    this.client = new CallSofiaClient(config);
    this.db = new SignalDatabase(path.join(dataDir, 'signals.db'));
    this.parser = new SignalParser();
    this.options = options;

    this.progressBar = new cliProgress.SingleBar({
      format: 'Scraping |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s | Scraped: {scraped} | Errors: {errors} | Not Found: {notFound}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });
  }

  async run(): Promise<void> {
    console.log('\n=== CallSofia Scraper ===\n');

    // Test connection
    console.log('Testing connection...');
    const connected = await this.client.testConnection();
    if (!connected) {
      console.error('Failed to connect. Check your cookies in .env file.');
      process.exit(1);
    }
    console.log('Connection successful!\n');

    // Fetch and save categories
    console.log('Fetching categories...');
    await this.syncCategories();

    // Determine ID range
    let { start, end } = this.options;

    if (this.options.resume) {
      const progress = this.db.getProgress();
      if (progress.lastScrapedId > 0) {
        start = Math.max(start, progress.lastScrapedId + 1);
        console.log(`Resuming from ID ${start}`);
      }
    }

    // Get IDs to scrape
    let idsToScrape: number[];
    if (this.options.skipExisting) {
      console.log('Finding missing IDs...');
      idsToScrape = this.db.getMissingIds(start, end);
      console.log(`Found ${idsToScrape.length} missing IDs to scrape`);
    } else {
      idsToScrape = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }

    if (idsToScrape.length === 0) {
      console.log('No IDs to scrape. Exiting.');
      return;
    }

    console.log(`\nScraping ${idsToScrape.length} signals (IDs ${idsToScrape[0]} to ${idsToScrape[idsToScrape.length - 1]})`);
    console.log(`Concurrency: ${this.options.concurrency}, Delay: ${this.options.delay}ms\n`);

    // Start progress bar
    this.progressBar.start(idsToScrape.length, 0, {
      scraped: 0,
      errors: 0,
      notFound: 0,
    });

    // Process in batches
    const limit = pLimit(this.options.concurrency);

    for (let i = 0; i < idsToScrape.length; i += this.options.batchSize) {
      const batch = idsToScrape.slice(i, i + this.options.batchSize);

      const promises = batch.map(id =>
        limit(async () => {
          await this.scrapeSignal(id);
          await this.client.sleep(this.options.delay);
        })
      );

      await Promise.all(promises);

      // Update progress bar
      this.progressBar.update(i + batch.length, {
        scraped: this.stats.scraped,
        errors: this.stats.errors,
        notFound: this.stats.notFound,
      });
    }

    this.progressBar.stop();

    // Print summary
    console.log('\n=== Scrape Complete ===');
    console.log(`Total processed: ${this.stats.scraped + this.stats.skipped + this.stats.errors + this.stats.notFound}`);
    console.log(`Scraped: ${this.stats.scraped}`);
    console.log(`Skipped (existing): ${this.stats.skipped}`);
    console.log(`Not found (404): ${this.stats.notFound}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`\nDatabase: ${path.resolve(dataDir, 'signals.db')}`);
  }

  private async scrapeSignal(id: number): Promise<void> {
    try {
      // Check if already exists (if not skipping)
      if (!this.options.skipExisting && this.db.signalExists(id)) {
        this.stats.skipped++;
        return;
      }

      // Fetch HTML
      const html = await this.client.withRetry(() =>
        this.client.getSignalDetailsHtml(id)
      );

      if (html === null) {
        // Signal doesn't exist (404)
        this.stats.notFound++;
        this.db.updateProgress(id, 0, 0);
        return;
      }

      // Check for "not found" message in HTML
      if (html.includes('Няма регистриран сигнал') || html.includes('Невалиден номер')) {
        this.stats.notFound++;
        this.db.updateProgress(id, 0, 0);
        return;
      }

      // Parse signal
      const signal = this.parser.parse(html, id);

      if (!signal) {
        this.stats.notFound++;
        this.db.updateProgress(id, 0, 0);
        return;
      }

      // Lookup category and subcategory IDs from names
      const { categoryId, subcategoryId } = this.db.lookupCategoryIds(
        signal.categoryName,
        signal.subcategoryName
      );
      signal.categoryId = categoryId;
      signal.subcategoryId = subcategoryId;

      // Save raw HTML if requested
      if (this.options.saveHtml) {
        signal.rawHtml = html;
      }

      // Save to database
      this.db.upsertSignal(signal);

      // Fetch additional data if requested
      if (this.options.fetchExtras) {
        await this.fetchExtras(id);
      }

      this.stats.scraped++;
      this.db.updateProgress(id, 1, 0);
    } catch (error) {
      this.stats.errors++;
      this.db.updateProgress(id, 0, 1);
      this.db.logError(id, (error as Error).message, 'scrape');
    }
  }

  private async fetchExtras(signalId: number): Promise<void> {
    try {
      // Fetch status history
      const statusHistory = await this.client.getStatusHistory(signalId);
      if (statusHistory.length > 0) {
        this.db.insertStatusHistory(statusHistory);
      }

      // Fetch clerk answers
      const clerkAnswers = await this.client.getClerkAnswers(signalId);
      if (clerkAnswers.length > 0) {
        this.db.insertClerkAnswers(clerkAnswers);
      }
    } catch (error) {
      // Log but don't fail the main scrape
      console.error(`Error fetching extras for signal ${signalId}:`, error);
    }
  }

  private async syncCategories(): Promise<void> {
    const categories = await this.client.getCategories();
    if (categories.length > 0) {
      this.db.upsertCategories(categories);
      console.log(`Synced ${categories.length} categories`);
    }

    const subcategories = await this.client.getSubcategories();
    if (subcategories.length > 0) {
      this.db.upsertSubcategories(subcategories);
      console.log(`Synced ${subcategories.length} subcategories`);
    }
  }

  close(): void {
    this.db.close();
  }
}

// CLI Setup
const program = new Command();

program
  .name('callsofia-scraper')
  .description('Scraper for call.sofia.bg public signals database')
  .version('1.0.0')
  .option('-s, --start <number>', 'Start signal ID', '1')
  .option('-e, --end <number>', 'End signal ID', '680000')
  .option('-c, --concurrency <number>', 'Number of concurrent requests', '5')
  .option('-d, --delay <number>', 'Delay between requests in ms', '200')
  .option('-r, --resume', 'Resume from last scraped ID', false)
  .option('--skip-existing', 'Skip IDs already in database', false)
  .option('--save-html', 'Save raw HTML to database', false)
  .option('--fetch-extras', 'Fetch status history and clerk answers', false)
  .option('-b, --batch-size <number>', 'Batch size for processing', '100');

program.parse();

const opts = program.opts();

// Load config from environment
const config: Partial<ScraperConfig> = {
  cookies: {
    aspxAuth: process.env.ASPX_AUTH || '',
    requestVerificationToken: process.env.REQUEST_VERIFICATION_TOKEN || '',
    sessionToken: process.env.SESSION_TOKEN,
  },
};

// Validate cookies
if (!config.cookies?.aspxAuth || !config.cookies?.requestVerificationToken) {
  console.error('Error: Missing authentication cookies.');
  console.error('Please create a .env file with:');
  console.error('  ASPX_AUTH=your_aspx_auth_cookie');
  console.error('  REQUEST_VERIFICATION_TOKEN=your_token');
  console.error('  SESSION_TOKEN=optional_session_token');
  process.exit(1);
}

const options: ScrapeOptions = {
  start: parseInt(opts.start, 10),
  end: parseInt(opts.end, 10),
  concurrency: parseInt(opts.concurrency, 10),
  delay: parseInt(opts.delay, 10),
  resume: opts.resume,
  skipExisting: opts.skipExisting,
  saveHtml: opts.saveHtml,
  fetchExtras: opts.fetchExtras,
  batchSize: parseInt(opts.batchSize, 10),
};

// Run scraper
const scraper = new Scraper(config, options);

process.on('SIGINT', () => {
  console.log('\n\nInterrupted. Saving progress...');
  scraper.close();
  process.exit(0);
});

scraper.run()
  .then(() => {
    scraper.close();
  })
  .catch(error => {
    console.error('Fatal error:', error);
    scraper.close();
    process.exit(1);
  });
