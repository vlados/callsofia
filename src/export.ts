#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { SignalDatabase } from './database.js';
import type { Signal, ExportOptions } from './types.js';

const dataDir = './data';
const exportDir = './exports';

// Ensure export directory exists
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

class DataExporter {
  private db: SignalDatabase;

  constructor() {
    this.db = new SignalDatabase(path.join(dataDir, 'signals.db'));
  }

  export(options: ExportOptions): void {
    console.log('\n=== CallSofia Data Export ===\n');

    // Get signals based on filters
    let signals = this.getFilteredSignals(options);

    console.log(`Found ${signals.length} signals matching criteria`);

    if (signals.length === 0) {
      console.log('No signals to export.');
      return;
    }

    // Add related data if requested
    if (options.includeStatusHistory || options.includeClerkAnswers) {
      signals = signals.map(signal => {
        const enriched: any = { ...signal };

        if (options.includeStatusHistory) {
          enriched.statusHistory = this.db.getStatusHistory(signal.id);
        }

        if (options.includeClerkAnswers) {
          enriched.clerkAnswers = this.db.getClerkAnswers(signal.id);
        }

        return enriched;
      });
    }

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let filename = `signals_${timestamp}`;

    if (options.subcategoryId) {
      filename = `signals_subcat_${options.subcategoryId}_${timestamp}`;
    } else if (options.categoryId) {
      filename = `signals_cat_${options.categoryId}_${timestamp}`;
    }

    // Export based on format
    switch (options.format) {
      case 'json':
        this.exportJson(signals, filename);
        break;
      case 'csv':
        this.exportCsv(signals, filename);
        break;
      default:
        console.log('Database is already in SQLite format at:', path.resolve(dataDir, 'signals.db'));
    }

    console.log('\nExport complete!');
  }

  private getFilteredSignals(options: ExportOptions): Signal[] {
    // Start with all signals or filtered by category
    let signals: Signal[];

    if (options.subcategoryId) {
      signals = this.db.getSignalsBySubcategory(options.subcategoryId);
    } else if (options.categoryId) {
      signals = this.db.getSignalsByCategory(options.categoryId);
    } else {
      signals = this.db.getAllSignals();
    }

    // Apply additional filters
    if (options.district) {
      signals = signals.filter(s => s.district === options.district);
    }

    if (options.status) {
      signals = signals.filter(s => s.status === options.status);
    }

    if (options.startDate || options.endDate) {
      signals = signals.filter(s => {
        if (!s.registrationDate) return false;

        // Parse Bulgarian date format (DD.MM.YYYY)
        const dateParts = s.registrationDate.split(' ')[0].split('.');
        if (dateParts.length < 3) return false;

        const signalDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

        if (options.startDate && signalDate < options.startDate) return false;
        if (options.endDate && signalDate > options.endDate) return false;

        return true;
      });
    }

    return signals;
  }

  private exportJson(signals: any[], filename: string): void {
    const filepath = path.join(exportDir, `${filename}.json`);

    // Remove rawHtml from export to reduce file size
    const cleanSignals = signals.map(s => {
      const { rawHtml, ...rest } = s;
      return rest;
    });

    fs.writeFileSync(filepath, JSON.stringify(cleanSignals, null, 2), 'utf8');
    console.log(`Exported to: ${path.resolve(filepath)}`);
    console.log(`File size: ${(fs.statSync(filepath).size / 1024 / 1024).toFixed(2)} MB`);
  }

  private exportCsv(signals: Signal[], filename: string): void {
    const filepath = path.join(exportDir, `${filename}.csv`);

    // CSV headers
    const headers = [
      'id',
      'registration_number',
      'registration_date',
      'category_id',
      'category_name',
      'subcategory_id',
      'subcategory_name',
      'status',
      'district',
      'neighborhood',
      'address',
      'latitude',
      'longitude',
      'description',
      'problem_location',
      'has_documents',
    ];

    // Build CSV content
    const rows = signals.map(signal => {
      return [
        signal.id,
        this.escapeCsv(signal.registrationNumber),
        this.escapeCsv(signal.registrationDate),
        signal.categoryId,
        this.escapeCsv(signal.categoryName),
        signal.subcategoryId,
        this.escapeCsv(signal.subcategoryName),
        this.escapeCsv(signal.status),
        this.escapeCsv(signal.district),
        this.escapeCsv(signal.neighborhood),
        this.escapeCsv(signal.address),
        signal.latitude,
        signal.longitude,
        this.escapeCsv(signal.description),
        this.escapeCsv(signal.problemLocation),
        signal.hasDocuments ? 1 : 0,
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    fs.writeFileSync(filepath, '\ufeff' + csv, 'utf8'); // BOM for Excel UTF-8 support
    console.log(`Exported to: ${path.resolve(filepath)}`);
    console.log(`File size: ${(fs.statSync(filepath).size / 1024 / 1024).toFixed(2)} MB`);
  }

  private escapeCsv(value: string | null | undefined): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  close(): void {
    this.db.close();
  }
}

// CLI Setup
const program = new Command();

program
  .name('callsofia-export')
  .description('Export signals from CallSofia database')
  .version('1.0.0')
  .option('-f, --format <format>', 'Export format: json, csv, or sqlite', 'json')
  .option('-c, --category <id>', 'Filter by category ID (e.g., 3 for Road Infrastructure)')
  .option('-s, --subcategory <id>', 'Filter by subcategory ID (e.g., 30271 for Bicycle Infrastructure)')
  .option('--district <name>', 'Filter by district name')
  .option('--status <status>', 'Filter by status')
  .option('--start-date <date>', 'Filter by start date (YYYY-MM-DD)')
  .option('--end-date <date>', 'Filter by end date (YYYY-MM-DD)')
  .option('--include-history', 'Include status history in export', false)
  .option('--include-answers', 'Include clerk answers in export', false);

program.parse();

const opts = program.opts();

const exportOptions: ExportOptions = {
  format: opts.format as 'json' | 'csv' | 'sqlite',
  categoryId: opts.category ? parseInt(opts.category, 10) : undefined,
  subcategoryId: opts.subcategory ? parseInt(opts.subcategory, 10) : undefined,
  district: opts.district,
  status: opts.status,
  startDate: opts.startDate,
  endDate: opts.endDate,
  includeStatusHistory: opts.includeHistory,
  includeClerkAnswers: opts.includeAnswers,
};

// Run export
const exporter = new DataExporter();

exporter.export(exportOptions);
exporter.close();
