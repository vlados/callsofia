// Signal data structure extracted from call.sofia.bg

export interface Signal {
  id: number;
  registrationNumber: string | null;
  registrationDate: string | null;
  categoryId: number | null;
  categoryName: string | null;
  subcategoryId: number | null;
  subcategoryName: string | null;
  status: string | null;
  statusDate: string | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  problemLocation: string | null;
  hasDocuments: boolean;
  createdAt: string;
  updatedAt: string;
  rawHtml?: string;
}

export interface StatusHistoryEntry {
  signalId: number;
  status: string;
  date: string;
  note: string | null;
}

export interface ClerkAnswer {
  signalId: number;
  registrationNumber: string | null;
  date: string;
  content: string | null;
  institution: string | null;
}

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
}

export interface Subcategory {
  id: number;
  name: string;
  fullName: string;
  parentCategoryId: number;
}

// API response types
export interface JqGridResponse<T> {
  total: number;
  page: number;
  records: number;
  rows: T[];
}

export interface StatusHistoryRow {
  id: number;
  cell: [string, string, string]; // [status, date, note]
}

export interface ClerkAnswerRow {
  id: number;
  cell: [string, string, string, string]; // [regNumber, date, content, institution]
}

export interface CategoryApiItem {
  ID: number;
  Value: string;
}

export interface SubcategoryApiItem {
  ID: number;
  Value: string; // Format: "ParentCategory-SubcategoryName"
}

// Scraper configuration
export interface ScraperConfig {
  baseUrl: string;
  cookies: {
    aspxAuth: string;
    requestVerificationToken: string;
    sessionToken?: string;
  };
  concurrency: number;
  delayMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  saveRawHtml: boolean;
  batchSize: number;
}

// Progress tracking
export interface ScrapeProgress {
  lastScrapedId: number;
  totalScraped: number;
  totalErrors: number;
  startedAt: string;
  lastUpdatedAt: string;
}

// Export options
export interface ExportOptions {
  format: 'json' | 'csv' | 'sqlite';
  categoryId?: number;
  subcategoryId?: number;
  startDate?: string;
  endDate?: string;
  status?: string;
  district?: string;
  includeStatusHistory?: boolean;
  includeClerkAnswers?: boolean;
}
