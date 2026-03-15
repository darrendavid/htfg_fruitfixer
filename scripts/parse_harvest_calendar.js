'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SOURCE_FILE = path.resolve(__dirname, '../content/source/HawaiiFruit. Net/fruit-time.htm');
const OUTPUT_FILE = path.resolve(__dirname, '../content/parsed/phase1_harvest_calendar.json');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isAvailable(cellText) {
  // Any non-empty text that contains an 'x' (xx, x, xxx, etc.) counts as available
  const trimmed = cellText.trim().toLowerCase();
  return trimmed.includes('x');
}

function extractPlants(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const plants = [];

  // The table has a header row (row index 0 = disclaimer, row index 1 = column headers)
  // Data rows start at index 2 and each has 14 cells:
  //   [0] row number, [1] common name, [2] botanical name, [3..14] months Jan-Dec

  const rows = $('table tr').toArray();

  for (const row of rows) {
    const cells = $(row).find('td').toArray();

    // Need at least 15 cells (index 0-14) for a valid data row
    // (col 0 = number, col 1 = common name, col 2 = botanical, cols 3-14 = 12 months)
    if (cells.length < 14) continue;

    // First cell should be a positive integer (row number)
    const rowNumText = $(cells[0]).text().trim();
    if (!/^\d+$/.test(rowNumText)) continue;

    const rowNum = parseInt(rowNumText, 10);

    // Common name: may contain <a> tags (anchors) and <br> — get full text
    const commonName = $(cells[1]).text().trim().replace(/\s+/g, ' ');
    if (!commonName) continue;  // skip empty rows

    // Botanical name
    const botanicalName = $(cells[2]).text().trim().replace(/\s+/g, ' ');

    // Months: cells 3 through 14 (indices 3-14, 12 cells = Jan-Dec)
    const harvestMonths = [];
    for (let m = 0; m < 12; m++) {
      const cellIndex = 3 + m;
      if (cellIndex >= cells.length) break;
      const cellText = $(cells[cellIndex]).text();
      if (isAvailable(cellText)) {
        harvestMonths.push(m + 1);  // 1-based month number
      }
    }

    plants.push({
      row_number: rowNum,
      common_name: commonName,
      botanical_name: botanicalName,
      harvest_months: harvestMonths,
      notes: ''
    });
  }

  return plants;
}

function main() {
  const html = fs.readFileSync(SOURCE_FILE, 'utf8');
  const plants = extractPlants(html);

  const output = {
    source_file: 'content/source/HawaiiFruit. Net/fruit-time.htm',
    extracted_date: new Date().toISOString().slice(0, 10),
    note: 'Harvest data collected continuously by Ken Love (2001-2002), HTFG-West Hawaii. Harvest times vary greatly from mauka to makai.',
    month_legend: MONTH_NAMES,
    plant_count: plants.length,
    plants: plants
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  console.log(`Extracted ${plants.length} plants.`);
  console.log(`Output written to: ${OUTPUT_FILE}`);

  // Print a quick summary for verification
  console.log('\nSample records:');
  for (const p of plants.slice(0, 5)) {
    console.log(`  [${p.row_number}] ${p.common_name} (${p.botanical_name}) — months: [${p.harvest_months.join(', ')}]`);
  }
}

main();
