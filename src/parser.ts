import * as cheerio from 'cheerio';
import type { Signal } from './types.js';

export class SignalParser {
  parse(html: string, signalId: number): Signal | null {
    const $ = cheerio.load(html);

    // Check if signal exists (404 page check)
    const bodyText = $('body').text();
    if (bodyText.includes('Няма регистриран сигнал') || bodyText.includes('Невалиден номер')) {
      return null;
    }

    // Extract signal header info from the h3 in content-wrapper
    // Format: "Сигнал №{id}/ {regNumber}/ {date}"
    const headerText = $('.content-wrapper h3').text().trim() ||
                       $('h3:contains("Сигнал №")').text().trim();

    let registrationNumber: string | null = null;
    let registrationDate: string | null = null;

    // Extract date from header
    const dateMatch = headerText.match(/(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})/);
    if (dateMatch) {
      registrationDate = dateMatch[1];
    }

    // Extract registration number (format: СО14-КЦ-199 or СОА18-КЦ01-28730)
    const regNumMatch = headerText.match(/(СО[А]?\d{2}-КЦ\d{0,2}-?\d+(?:-\[\d+\])?)/);
    if (regNumMatch) {
      registrationNumber = regNumMatch[1];
    }

    // Extract status from status indicator
    const status = $('#statusIndicator').first().text().trim() ||
                   $('#statusName').text().trim() ||
                   $('.status_indicator').first().text().trim();

    // Extract category and subcategory from h4 after h3
    // Format: <h4>... Category / <i>Subcategory</i></h4>
    const categoryH4 = $('.content-wrapper h4').first();
    let categoryName: string | null = null;
    let subcategoryName: string | null = null;
    let categoryId: number | null = null;
    let subcategoryId: number | null = null;

    if (categoryH4.length) {
      const h4Text = categoryH4.text().trim();
      // Extract subcategory from italic text
      const subcatItalic = categoryH4.find('i').last().text().trim();
      if (subcatItalic) {
        subcategoryName = subcatItalic;
      }

      // Extract category - text before the slash
      const parts = h4Text.split('/').map(s => s.trim());
      if (parts.length >= 1) {
        // Remove any icon classes or empty text
        categoryName = parts[0].replace(/^\s*$/, '').trim() || null;
        if (!categoryName && parts.length >= 2) {
          categoryName = parts[1].replace(subcategoryName || '', '').trim() || null;
        }
      }

      // If we have both, use the text-based split
      if (h4Text.includes('/')) {
        const splitParts = h4Text.split('/');
        if (splitParts.length >= 2) {
          categoryName = splitParts[0].trim() || null;
          // Subcategory might be in italic
          subcategoryName = subcatItalic || splitParts[1].trim() || null;
        }
      }
    }

    // Extract location data - look for row with label and col-md-10 value
    const district = this.extractRowValue($, 'Район');

    const neighborhood = this.extractRowValue($, 'ж.к.') ||
                         this.extractRowValue($, 'Квартал') ||
                         this.extractRowValue($, 'NEIGHBOURHOOD');

    const address = this.extractRowValue($, 'Приблизителен адрес') ||
                    this.extractRowValue($, 'Улица') ||
                    this.extractRowValue($, 'ADDRESS');

    // Extract coordinates from the location row or map
    let latitude: number | null = null;
    let longitude: number | null = null;

    // First try to get from the "Местоположение" row which has format [lat,lng]
    const locationText = this.extractRowValue($, 'Местоположение') ||
                         this.extractRowValue($, 'LOCATION');
    if (locationText) {
      const coordMatch = locationText.match(/\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/);
      if (coordMatch) {
        latitude = parseFloat(coordMatch[1]);
        longitude = parseFloat(coordMatch[2]);
      }
    }

    // Fallback: try to find in scripts
    if (!latitude || !longitude) {
      const scriptContent = $('script').text();
      const mapDataMatch = scriptContent.match(/\[\s*(4\d\.\d+)\s*,\s*(2\d\.\d+)\s*\]/);
      if (mapDataMatch) {
        latitude = parseFloat(mapDataMatch[1]);
        longitude = parseFloat(mapDataMatch[2]);
      }
    }

    // Extract description from og:description meta tag
    let description = $('meta[property="og:description"]').attr('content') || null;

    // If no og:description, try to find in panels
    if (!description) {
      description = this.extractDescription($);
    }

    // Extract problem location type (where the problem is: in park, on street, etc.)
    const problemLocation = this.extractRowValue($, 'Проблемът се намира') ||
                            this.extractRowValue($, 'Местоположение на проблема');

    // Check for documents
    const hasDocuments = $('.document-list').length > 0 ||
                         $('a[href*="Document"]').length > 0 ||
                         $('a[href*="Attachment"]').length > 0;

    // Try to extract category IDs from page scripts
    const allScripts = $('script').text();
    const subcatIdMatch = allScripts.match(/subcategoryId['":\s]+(\d+)/i);
    if (subcatIdMatch) {
      subcategoryId = parseInt(subcatIdMatch[1]);
    }

    const catIdMatch = allScripts.match(/categoryId['":\s]+(\d+)/i);
    if (catIdMatch) {
      categoryId = parseInt(catIdMatch[1]);
    }

    return {
      id: signalId,
      registrationNumber,
      registrationDate,
      categoryId,
      categoryName,
      subcategoryId,
      subcategoryName,
      status,
      statusDate: registrationDate, // Often the same initially
      district,
      neighborhood,
      address,
      latitude,
      longitude,
      description,
      problemLocation,
      hasDocuments,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Extract value from Bootstrap row format: <label>...</label> <div class="col-md-10">value</div>
  private extractRowValue($: cheerio.CheerioAPI, label: string): string | null {
    // Find label elements containing the text
    const labels = $(`label:contains("${label}")`);

    for (let i = 0; i < labels.length; i++) {
      const labelEl = labels.eq(i);
      // Get the sibling div with col-md-10 class
      const valueDiv = labelEl.siblings('.col-md-10').first();
      if (valueDiv.length) {
        const text = valueDiv.text().trim();
        if (text && text.length > 0) {
          return text;
        }
      }

      // Try the next sibling
      const nextSibling = labelEl.next();
      if (nextSibling.length) {
        const text = nextSibling.text().trim();
        if (text && text.length > 0 && text.length < 500) {
          return text;
        }
      }
    }

    // Also try within .row divs
    const rows = $('.row');
    for (let i = 0; i < rows.length; i++) {
      const row = rows.eq(i);
      const rowText = row.text();
      if (rowText.includes(label)) {
        const valueDiv = row.find('.col-md-10').first();
        if (valueDiv.length) {
          const text = valueDiv.text().trim();
          if (text && text.length > 0) {
            return text;
          }
        }
      }
    }

    return null;
  }

  private extractDescription($: cheerio.CheerioAPI): string | null {
    // Try multiple patterns for description
    const descriptionSelectors = [
      '.signal-description',
      '.description',
      '#description',
      'textarea[name*="escription"]',
      '.form-group:contains("Описание") .form-control-static',
      'dt:contains("Описание") + dd',
      '.panel-body p',
    ];

    for (const selector of descriptionSelectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text && text.length > 10) {
          return text;
        }
      }
    }

    // Look for the description in the page content
    const pageContent = $('.signal-content, .content, .panel-body, main').text();
    if (pageContent.includes('Описание')) {
      const descMatch = pageContent.match(/Описание[:\s]*([\s\S]*?)(?=Статус|Категория|Район|$)/i);
      if (descMatch && descMatch[1]) {
        const desc = descMatch[1].trim();
        if (desc.length > 10 && desc.length < 5000) {
          return desc;
        }
      }
    }

    return null;
  }

  // Extract all visible text content from the page (for debugging/raw storage)
  extractRawContent($: cheerio.CheerioAPI): string {
    // Remove script and style elements
    $('script, style, noscript').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
  }

  // Parse the category/subcategory mapping
  parseSubcategoryFromFullName(fullName: string): { category: string; subcategory: string } {
    const parts = fullName.split('-');
    return {
      category: parts[0]?.trim() || '',
      subcategory: parts.slice(1).join('-').trim(),
    };
  }
}
