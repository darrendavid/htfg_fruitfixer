/**
 * Phase 3 - Task 1: Harvest Calendar Extractor
 * Source: content/source/HawaiiFruit. Net/fruit-time.htm
 * Output: content/parsed/phase3_harvest_calendar.json
 *
 * The file is an Excel-exported HTML table with 100 fruit rows.
 * Columns: row#, common_name, botanical_name, Jan..Dec (marked "xx" if harvestable).
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SOURCE_FILE = resolve(ROOT, 'content/source/HawaiiFruit. Net/fruit-time.htm');
const OUTPUT_FILE = resolve(ROOT, 'content/parsed/phase3_harvest_calendar.json');
const SOURCE_REL  = 'HawaiiFruit. Net/fruit-time.htm';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function extractHarvestCalendar() {
  console.log('Reading:', SOURCE_FILE);
  const html = readFileSync(SOURCE_FILE, 'latin1'); // macintosh charset — latin1 is close enough
  const $ = cheerio.load(html, { decodeEntities: false });

  const records = [];
  let skippedRows = 0;

  $('table tr').each((rowIdx, rowEl) => {
    const cells = $(rowEl).find('td');

    // Need at least 3 cols (row#, name, botanical) + 12 month cols = 15 total
    // But header row has different content — we detect by checking if col[0] is a number
    if (cells.length < 14) {
      skippedRows++;
      return;
    }

    // First cell: row number (skip header row which has text "FRUIT...")
    const rowNumText = $(cells[0]).text().trim();
    if (!/^\d+$/.test(rowNumText)) {
      skippedRows++;
      return;
    }

    // Second cell: common name (may contain an <a> anchor)
    const commonRaw = $(cells[1]).text().trim();
    if (!commonRaw) {
      skippedRows++;
      return;
    }

    // Third cell: botanical name (italic)
    const botanicalRaw = $(cells[2]).text().trim();

    // Columns 3–14 (0-indexed): Jan through Dec
    // The table has 15 cols per row (index, name, botanical, 12 months)
    const months = [];
    for (let m = 0; m < 12; m++) {
      const cell = cells[3 + m];
      if (!cell) continue;
      const val = $(cell).text().trim().toLowerCase();
      // Presence markers: "xx", "x", "xxx", "  xxx", etc. — any non-empty non-whitespace
      if (val && /x/.test(val)) {
        months.push(MONTHS[m]);
      }
    }

    records.push({
      row: parseInt(rowNumText, 10),
      common_name: commonRaw,
      botanical_name: botanicalRaw || null,
      months,
      source_file: SOURCE_REL,
    });
  });

  console.log(`Extracted ${records.length} fruit records (skipped ${skippedRows} non-data rows).`);

  // Sanity check: print first 3 and last 3
  if (records.length > 0) {
    console.log('\nFirst 3 records:');
    records.slice(0, 3).forEach(r => console.log(`  [${r.row}] ${r.common_name} | ${r.botanical_name} | months: ${r.months.join(', ') || '(none listed)'}`));
    console.log('Last 3 records:');
    records.slice(-3).forEach(r => console.log(`  [${r.row}] ${r.common_name} | ${r.botanical_name} | months: ${r.months.join(', ') || '(none listed)'}`));
  }

  const output = {
    extracted_at: new Date().toISOString(),
    source_file: SOURCE_REL,
    record_count: records.length,
    records,
  };

  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nOutput written to: ${OUTPUT_FILE}`);
}

extractHarvestCalendar();
