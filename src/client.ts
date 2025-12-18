import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  ScraperConfig,
  JqGridResponse,
  StatusHistoryRow,
  ClerkAnswerRow,
  CategoryApiItem,
  SubcategoryApiItem,
  StatusHistoryEntry,
  ClerkAnswer,
  Category,
  Subcategory,
} from './types.js';

const DEFAULT_CONFIG: Partial<ScraperConfig> = {
  baseUrl: 'https://call.sofia.bg',
  concurrency: 5,
  delayMs: 200,
  retryAttempts: 3,
  retryDelayMs: 1000,
  batchSize: 100,
};

export class CallSofiaClient {
  private client: AxiosInstance;
  private config: ScraperConfig;

  constructor(config: Partial<ScraperConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config } as ScraperConfig;

    // Build cookie string
    const cookies = [
      `.ASPXAUTH=${this.config.cookies.aspxAuth}`,
      `__RequestVerificationToken=${this.config.cookies.requestVerificationToken}`,
    ];
    if (this.config.cookies.sessionToken) {
      cookies.push(`TS019ad0ce=${this.config.cookies.sessionToken}`);
    }

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en,bg;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
        'Cookie': cookies.join('; '),
        'DNT': '1',
      },
    });
  }

  async getSignalDetailsHtml(id: number): Promise<string | null> {
    try {
      const response = await this.client.get(`/bg/Signal/Details`, {
        params: { id },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 404) {
          return null;
        }
      }
      throw error;
    }
  }

  async getStatusHistory(signalId: number): Promise<StatusHistoryEntry[]> {
    try {
      const response = await this.client.post<JqGridResponse<StatusHistoryRow>>(
        `/bg/Status/IndexJson/${signalId}`,
        '_search=false&rows=10000&page=1&sidx=&sord=asc',
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );

      // Handle empty or malformed responses
      if (!response.data?.rows || !Array.isArray(response.data.rows)) {
        return [];
      }

      return response.data.rows
        .filter(row => row?.cell && Array.isArray(row.cell))
        .map(row => ({
          signalId,
          status: row.cell[0] || '',
          date: row.cell[1] || '',
          note: row.cell[2] || null,
        }));
    } catch (error) {
      // Silently fail for status history - not critical
      return [];
    }
  }

  async getClerkAnswers(signalId: number): Promise<ClerkAnswer[]> {
    try {
      const response = await this.client.post<JqGridResponse<ClerkAnswerRow>>(
        `/bg/ClerkAnswer/IndexJson/${signalId}`,
        '_search=false&rows=10000&page=1&sidx=&sord=asc',
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
        }
      );

      // Handle empty or malformed responses
      if (!response.data?.rows || !Array.isArray(response.data.rows)) {
        return [];
      }

      return response.data.rows
        .filter(row => row?.cell && Array.isArray(row.cell))
        .map(row => ({
          signalId,
          registrationNumber: row.cell[0] || null,
          date: row.cell[1] || '',
          content: row.cell[2] || null,
          institution: row.cell[3] || null,
        }));
    } catch (error) {
      // Silently fail for clerk answers - not critical
      return [];
    }
  }

  async getCategories(): Promise<Category[]> {
    try {
      const response = await this.client.get<CategoryApiItem[]>('/bg/Signal/GetCategory', {
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      return response.data.map(item => ({
        id: item.ID,
        name: item.Value,
        parentId: null,
      }));
    } catch (error) {
      console.error('Error fetching categories:', error);
      return [];
    }
  }

  async getSubcategories(): Promise<Subcategory[]> {
    try {
      const response = await this.client.get<SubcategoryApiItem[]>('/bg/Signal/GetCategoryScript', {
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      return response.data.map(item => {
        const parts = item.Value.split('-');
        const parentName = parts[0];
        const name = parts.slice(1).join('-');

        // Extract parent category ID from subcategory ID
        // ID pattern: {parentCategoryID}{subcategoryNumber}
        const parentCategoryId = this.extractParentCategoryId(item.ID);

        return {
          id: item.ID,
          name: name.trim(),
          fullName: item.Value,
          parentCategoryId,
        };
      });
    } catch (error) {
      console.error('Error fetching subcategories:', error);
      return [];
    }
  }

  private extractParentCategoryId(subcategoryId: number): number {
    // The parent category ID is embedded in the subcategory ID
    // Examples: 30271 -> 3, 280068 -> 28, 270034 -> 27
    const idStr = subcategoryId.toString();

    // Check known parent IDs from longest to shortest
    const knownParentIds = [33, 32, 30, 28, 27, 38, 40, 22, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    for (const parentId of knownParentIds) {
      if (idStr.startsWith(parentId.toString())) {
        return parentId;
      }
    }

    // Fallback: first 1-2 digits
    return parseInt(idStr.substring(0, 2)) || parseInt(idStr.substring(0, 1));
  }

  async testConnection(): Promise<boolean> {
    try {
      const categories = await this.getCategories();
      return categories.length > 0;
    } catch (error) {
      return false;
    }
  }

  // Retry wrapper
  async withRetry<T>(
    fn: () => Promise<T>,
    attempts: number = this.config.retryAttempts
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (i < attempts - 1) {
          await this.sleep(this.config.retryDelayMs * (i + 1));
        }
      }
    }

    throw lastError;
  }

  async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getConfig(): ScraperConfig {
    return this.config;
  }
}
