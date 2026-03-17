/**
 * Site Index Crawler
 *
 * Crawls all root-level index*.html/htm pages from HawaiiFruit.Net and builds
 * a rich link graph: which directories each index page references, with the
 * anchor text used for each link. This anchor text is the primary signal for
 * classifying directories as plant-related, personal, event-based, etc.
 *
 * Also performs one level of deeper crawl: for every directory referenced by
 * an index page, it reads that directory's own HTML to extract image captions
 * (alt text, title attributes, and text adjacent to <img> tags).
 *
 * Output: content/parsed/site_link_graph.json
 *
 * Usage: node scripts/crawl-site-index.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, basename, extname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

const ROOT        = join(import.meta.dirname, '..');
const SOURCE      = join(ROOT, 'content', 'source', 'HawaiiFruit. Net');
const PARSED      = join(ROOT, 'content', 'parsed');
const OUTPUT_FILE = join(PARSED, 'site_link_graph.json');
const REGISTRY_FILE = join(PARSED, 'plant_registry.json');

// ─── Plant name lookup (for detecting fruit keywords in link text) ────────────

const registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'));
const PLANT_NAMES = new Set();
for (const p of registry.plants) {
  PLANT_NAMES.add(p.common_name.toLowerCase());
  for (const a of (p.aliases || [])) PLANT_NAMES.add(a.toLowerCase());
  // Add short forms: "avocado" matches "avo", "loquat/biwa" → "biwa"
}
// Supplement with short forms and common aliases not in registry
const EXTRA_PLANT_TERMS = [
  'avocado', 'avo', 'fig', 'figs', 'ichijiku', 'mango', 'banana', 'lychee',
  'loquat', 'biwa', 'citrus', 'kumquat', 'kinkan', 'persimmon', 'kaki',
  'papaya', 'guava', 'coffee', 'macadamia', 'lilikoi', 'passion fruit',
  'pomegranate', 'zakuro', 'tangelo', 'tangerine', 'mandarin', 'orange',
  'grapefruit', 'pumelo', 'pomelo', 'rollinia', 'jackfruit', 'durian',
  'rambutan', 'mangosteen', 'longan', 'starfruit', 'carambola', 'jaboticaba',
  'surinam cherry', 'soursop', 'cherimoya', 'atemoya', 'sapote', 'abiu',
  'pitaya', 'dragon fruit', 'acerola', 'noni', 'stone fruit', 'peach',
  'plum', 'pear', 'apple', 'cherry', 'grape', 'strawberry', 'raspberry',
  'blueberry', 'mulberry', 'ulu', 'breadfruit', 'cacao', 'vanilla',
];
for (const t of EXTRA_PLANT_TERMS) PLANT_NAMES.add(t);

// Keywords that indicate non-fruit personal content
const PERSONAL_KEYWORDS = [
  'family', 'birthday', 'party', 'friends', 'personal', 'vacation', 'holiday',
  'wedding', 'anniversary', 'chicago', 'munich', 'italy', 'venice', 'bologna',
  'parma', 'florence', 'gondola', 'sumo', 'soba', 'noodle', 'yoshi', 'ikuzo',
  'offline', 'forum', 'sakura', 'cherry blossom', 'lake como', 'tuscany',
  'tuscan', 'montepulciano', 'horseback', 'sunflower', 'apartment', 'house',
  'mom', 'mother', 'grandkids', 'kids in chicago', 'high school', 'first grade',
  'accordian', 'musician', 'singer',
];

// Keywords that indicate conference/event content (keep but not plant-specific)
const EVENT_KEYWORDS = [
  'conference', 'foodex', 'expo', 'show', 'convention', 'symposium',
  'meeting', 'seminar', 'workshop', 'festival', 'award', 'htfg',
  'grant', 'project', 'posters', 'powerpoint', 'presentation',
];

// Keywords indicating research/educational (definitely keep)
const RESEARCH_KEYWORDS = [
  'research', 'experiment', 'station', 'university', 'ctahr', 'wsare',
  'variety trial', 'brix', 'harvest', 'planting', 'grafting', 'rootstock',
  'irrigation', 'data', 'report', 'analysis', 'publication',
];

// ─── URL → local directory resolution ────────────────────────────────────────

const SITE_ROOTS = [
  'http://www.hawaiifruit.net/',
  'http://hawaiifruit.net/',
  'https://www.hawaiifruit.net/',
];

/**
 * Given an href from a HawaiiFruit.net page, return the first path segment
 * (local directory name) or null if it's external/non-resolvable.
 *
 * e.g. "http://www.hawaiifruit.net/AVOVAR/index.html" → "AVOVAR"
 *      "AVOVAR/index.html" → "AVOVAR"
 *      "../somedir/file.html" → null  (relative above root, skip)
 *      "http://www.ctahr.hawaii.edu/..." → null  (external)
 */
function resolveToLocalDir(href) {
  if (!href || href.startsWith('mailto:') || href.startsWith('#')) return null;

  let path = null;

  // Absolute URL on site
  for (const root of SITE_ROOTS) {
    if (href.toLowerCase().startsWith(root)) {
      path = href.slice(root.length);
      break;
    }
  }

  // Relative URL (no http://, no leading /)
  if (path === null && !href.startsWith('http') && !href.startsWith('//')) {
    if (href.startsWith('../')) return null; // above root
    path = href.startsWith('/') ? href.slice(1) : href;
  }

  if (path === null) return null; // external

  // Strip query string and fragment
  path = path.split('?')[0].split('#')[0];
  if (!path) return null;

  // First path segment is the directory (or root-level file)
  const firstSegment = path.split('/')[0];
  if (!firstSegment) return null;

  // If it looks like a file at root level (no extension = dir, .htm/.html = page)
  const ext = extname(firstSegment).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    // Root-level HTML file, not a subdirectory
    return { type: 'root_file', name: firstSegment };
  }
  if (ext && ext !== '') {
    // Root-level non-HTML file (jpg, pdf, etc.)
    return { type: 'root_file', name: firstSegment };
  }

  // It's a directory
  return { type: 'dir', name: firstSegment };
}

// ─── Keyword scoring ──────────────────────────────────────────────────────────

function scoreLinkText(text) {
  if (!text) return { plant_terms: [], personal_score: 0, event_score: 0, research_score: 0 };
  const lower = text.toLowerCase();

  const plant_terms = [];
  for (const term of PLANT_NAMES) {
    if (term.length >= 3 && lower.includes(term)) {
      plant_terms.push(term);
    }
  }

  const personal_score = PERSONAL_KEYWORDS.filter(k => lower.includes(k)).length;
  const event_score    = EVENT_KEYWORDS.filter(k => lower.includes(k)).length;
  const research_score = RESEARCH_KEYWORDS.filter(k => lower.includes(k)).length;

  return { plant_terms, personal_score, event_score, research_score };
}

// ─── Extract image captions from an HTML string ───────────────────────────────

function extractImageCaptions(html, sourcePath) {
  const $ = cheerio.load(html);
  const captions = [];

  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    const alt = ($(el).attr('alt') || '').trim();
    const title = ($(el).attr('title') || '').trim();

    // Try to get surrounding text context
    const parent = $(el).parent();
    const grandparent = parent.parent();
    const cellText = (parent.text() + ' ' + grandparent.text())
      .replace(/\s+/g, ' ').trim().slice(0, 200);

    const fname = basename(src);
    if (fname && (alt || title || cellText)) {
      captions.push({
        image: fname,
        alt: alt || null,
        title: title || null,
        context: cellText || null,
      });
    }
  });

  return captions;
}

// ─── Main crawl ───────────────────────────────────────────────────────────────

console.log('Step 1: Finding index pages...');

// All index*.html and index*.htm at root level
const rootFiles = readdirSync(SOURCE, { withFileTypes: true })
  .filter(e => e.isFile() && /^index.*\.(html?)$/i.test(e.name))
  .map(e => e.name)
  .sort();

console.log(`  Found ${rootFiles.length} index pages:`, rootFiles.join(', '));

// Map: dir name → aggregated data
// Key is lowercased for dedup, value stores original case
const dirMap = new Map(); // dirName (original case) → object

function ensureDir(name) {
  // Find existing entry case-insensitively
  for (const [k] of dirMap) {
    if (k.toLowerCase() === name.toLowerCase()) return k;
  }
  dirMap.set(name, {
    dir: name,
    source_indexes: [],       // which index pages reference this dir
    links: [],                // [{ source_index, href, text, scores }]
    image_captions: [],       // captions extracted from inside this dir
    classification: null,     // set after analysis
    confidence: null,
    plant_id: null,
    topic: null,
    triage_action: null,      // 'auto_keep' | 'auto_reject' | 'review'
    notes: [],
  });
  return name;
}

// Step 2: Parse each index page
console.log('\nStep 2: Parsing index pages...');

const indexPageData = {};

for (const fileName of rootFiles) {
  const filePath = join(SOURCE, fileName);
  let html;
  try { html = readFileSync(filePath, 'utf8'); } catch { continue; }

  const $ = cheerio.load(html);
  const title = $('title').text().trim();
  const pageLinks = [];

  // Infer the topic from the filename
  const baseNoExt = fileName.replace(/\.(html?)$/i, '').toLowerCase();
  let pageTopicHint = null;
  if (baseNoExt.includes('personal'))   pageTopicHint = 'personal';
  else if (baseNoExt.includes('japan')) pageTopicHint = 'japan';
  else if (baseNoExt.includes('avo'))   pageTopicHint = 'avocado';
  else if (baseNoExt.includes('fig'))   pageTopicHint = 'fig';
  else if (baseNoExt.includes('stone')) pageTopicHint = 'stone_fruit';
  else if (baseNoExt.includes('recipe'))pageTopicHint = 'culinary';
  else if (baseNoExt.includes('htfg'))  pageTopicHint = 'organization';
  else if (baseNoExt.includes('epub'))  pageTopicHint = 'education';
  else if (baseNoExt.includes('pubs'))  pageTopicHint = 'publications';
  else if (baseNoExt.includes('poster'))pageTopicHint = 'posters';
  else if (baseNoExt.includes('pp'))    pageTopicHint = 'powerpoints';
  else if (baseNoExt.includes('gf'))    pageTopicHint = 'gluten_free';
  else if (baseNoExt.includes('rant'))  pageTopicHint = 'commentary';
  else if (baseNoExt.includes('video')) pageTopicHint = 'video';
  else if (baseNoExt.includes('data'))  pageTopicHint = 'fruit_data';
  else if (baseNoExt.includes('ohelo')) pageTopicHint = 'ohelo';
  else if (baseNoExt.includes('bircd')) pageTopicHint = 'grant';
  else if (baseNoExt.includes('indiacof')) pageTopicHint = 'india_coffee';

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    const resolved = resolveToLocalDir(href);
    if (!resolved) return;

    const scores = scoreLinkText(text);

    pageLinks.push({
      href,
      text,
      resolved_type: resolved.type,
      resolved_name: resolved.name,
      scores,
    });

    if (resolved.type === 'dir') {
      const canonicalKey = ensureDir(resolved.name);
      const entry = dirMap.get(canonicalKey);

      if (!entry.source_indexes.includes(fileName)) {
        entry.source_indexes.push(fileName);
      }
      entry.links.push({
        source_index: fileName,
        source_topic_hint: pageTopicHint,
        href,
        text,
        plant_terms: scores.plant_terms,
        personal_score: scores.personal_score,
        event_score: scores.event_score,
        research_score: scores.research_score,
      });
    }
  });

  indexPageData[fileName] = {
    file: fileName,
    title,
    topic_hint: pageTopicHint,
    link_count: pageLinks.length,
    dirs_referenced: [...new Set(
      pageLinks.filter(l => l.resolved_type === 'dir').map(l => l.resolved_name)
    )],
  };

  console.log(`  ${fileName}: "${title}" → ${pageLinks.filter(l => l.resolved_type === 'dir').length} dir links`);
}

// Step 3: Deeper crawl — read each referenced directory's HTML for image captions
console.log('\nStep 3: Reading directory HTML for image captions...');

let deepCount = 0;
for (const [dirName, entry] of dirMap) {
  const dirPath = join(SOURCE, dirName);
  if (!existsSync(dirPath)) continue;

  let htmlFiles;
  try {
    htmlFiles = readdirSync(dirPath, { withFileTypes: true })
      .filter(f => f.isFile() && /\.(html?)$/i.test(f.name))
      .map(f => f.name)
      .slice(0, 3); // Read up to 3 HTML files per dir to get captions
  } catch { continue; }

  for (const htmlFile of htmlFiles) {
    try {
      const html = readFileSync(join(dirPath, htmlFile), 'utf8');
      const captions = extractImageCaptions(html, `${dirName}/${htmlFile}`);
      entry.image_captions.push(...captions.slice(0, 30)); // Cap at 30
      deepCount++;
    } catch { /* skip unreadable files */ }
  }
}
console.log(`  Read ${deepCount} HTML files for captions`);

// Step 4: Classify each directory
console.log('\nStep 4: Classifying directories...');

// Known personal-only dirs that appear in personal index with zero fruit context
// (derived from link text analysis — these are travel/social/family galleries)
const ALWAYS_PERSONAL = new Set([
  'chicagokids', 'alptrek', 'veggieparade', 'munchen', 'munchen2',
  'smalltuscantown', 'miscmarg', 'orvietostreets', 'orvietocaves', 'onhorses',
  'Sunfhana', 'MPul', 'cdL', 'agritourismo1', 'CDPieve1', 'Firenze',
  'mk', 'mauhpf', 'vpapa', 'vittoriosfarm', 'abpollenzo', 'parma1', 'pdrp',
  'acp', 'parmaconserves', 'milanomisc', 'gonv', 'borgh', 'Gondola',
  'sanmarcoebelltower', 'morevenice', 'veronaday', 'lastsupperday', 'BOAToComo',
  'backtocomo', 'DuomoatNight', 'GFItaly1', 'sumohawaii', 'sumoup',
  'sakupl', 'soba1', 'soba2', 'soba3', 'soba4', 'soba5', 'soba6',
  '9_05fun', '32307_kagurazaka', 'TOSHIKIOFFPIX', '05bonnenkai', 'may05off',
  '305tadpix', '3_05off', 'dotdot', 'dot2', 'dotbday', 'bowen68',
  'biashop', 'mk', 'Manami',
]);

// Dirs where link text clearly identifies the plant even from personal page
const LINK_TEXT_PLANT_OVERRIDES = {
  'dalfig':     { plant_id: 'fig',         note: 'Dalmatian fig tree (personal page, but plant content)' },
  'bfmkt':      { plant_id: null,           note: 'Bologna Fruit Market (market, not specific plant)' },
  'rialtofruit':{ plant_id: null,           note: 'Venice Fruit Market at Rialto Bridge' },
  'munich_fruit':{ plant_id: null,          note: "Munich's fruit market and Rolf's trees" },
  'ortobot':    { plant_id: null,           note: "Parma's botanical garden - bonsai figs" },
  'cf':         { plant_id: 'fig',          note: 'Fig orchard in Chiba Japan (from index-figs.html)' },
  'dv':         { plant_id: null,           note: 'Yamanashi Fruit Park Views & Domes (from indexjapan.html)' },
  'spain':      { plant_id: null,           note: 'Spanish pavilion at Nagoya Worlds Fair fruit show' },
};

// Topic-index → plant mapping (dirs linked from these indexes are plant-specific)
const TOPIC_INDEX_PLANT = {
  'indexavo.html':        'avocado',
  'index-figs.html':      'fig',
  'indexstonefruit.html': null,   // stone fruit (multiple plants)
  'indexjapan.html':      null,   // japan (multiple plants — use link text)
  'indexdata.html':       null,   // fruit data pages
  'index-recipes.html':   null,   // culinary
  'index-pubs.html':      null,   // publications
  'index-htfg.html':      null,   // HTFG organization
  'indexohelo.html':      'poha', // Ohelo berry
  'indexposter.html':     null,   // posters
};

for (const [dirName, entry] of dirMap) {
  const notes = [];

  // Check override
  const lcDir = dirName.toLowerCase();
  const overrideKey = Object.keys(LINK_TEXT_PLANT_OVERRIDES)
    .find(k => k.toLowerCase() === lcDir);
  if (overrideKey) {
    const ov = LINK_TEXT_PLANT_OVERRIDES[overrideKey];
    entry.plant_id = ov.plant_id;
    notes.push(ov.note);
    entry.classification = ov.plant_id ? 'plant' : 'fruit_adjacent';
    entry.confidence = 'high';
    entry.triage_action = 'auto_keep';
    entry.notes = notes;
    continue;
  }

  // Check always-personal
  const isAlwaysPersonal = [...ALWAYS_PERSONAL].some(
    p => p.toLowerCase() === lcDir
  );
  if (isAlwaysPersonal) {
    entry.classification = 'personal';
    entry.confidence = 'high';
    entry.triage_action = 'auto_reject';
    entry.notes = ['Listed in personal index with no fruit content in link text'];
    continue;
  }

  // Aggregate scores across all links pointing to this dir
  let totalPlantTerms = new Set();
  let totalPersonalScore = 0;
  let totalEventScore = 0;
  let totalResearchScore = 0;
  let plantFromTopicIndex = null;
  const sourceTopics = new Set();

  for (const link of entry.links) {
    link.plant_terms.forEach(t => totalPlantTerms.add(t));
    totalPersonalScore  += link.personal_score;
    totalEventScore     += link.event_score;
    totalResearchScore  += link.research_score;

    // If linked from a plant-specific topic index, inherit that plant
    const plantFromIndex = TOPIC_INDEX_PLANT[link.source_index];
    if (plantFromIndex) plantFromTopicIndex = plantFromIndex;
    if (link.source_topic_hint) sourceTopics.add(link.source_topic_hint);
  }

  const plantTermsArray = [...totalPlantTerms];

  // Classification logic
  if (plantFromTopicIndex) {
    // Linked from a plant-specific index (avo, figs, etc.)
    entry.classification = 'plant';
    entry.plant_id = plantFromTopicIndex;
    entry.confidence = 'high';
    entry.triage_action = 'auto_keep';
    notes.push(`Linked from ${[...entry.source_indexes].join(', ')}`);
    if (plantTermsArray.length > 0) {
      notes.push(`Link text mentions: ${plantTermsArray.join(', ')}`);
    }
  } else if (plantTermsArray.length > 0) {
    // Link text mentions plant names
    entry.classification = 'plant';
    // Try to find specific plant from term
    entry.plant_id = findPlantId(plantTermsArray[0]) || null;
    entry.confidence = plantTermsArray.length >= 2 ? 'high' : 'medium';
    entry.triage_action = 'auto_keep';
    notes.push(`Link text mentions fruit: ${plantTermsArray.join(', ')}`);
    notes.push(`Sources: ${entry.source_indexes.join(', ')}`);
  } else if (sourceTopics.has('japan')) {
    // Linked from Japan index with no plant keyword — likely fruit park/market
    entry.classification = 'fruit_adjacent';
    entry.confidence = 'medium';
    entry.triage_action = 'auto_keep';
    notes.push('Linked from Japan fruit index — likely fruit-related context');
  } else if (sourceTopics.has('personal') && totalPersonalScore > 0) {
    entry.classification = 'personal';
    entry.confidence = 'medium';
    entry.triage_action = 'auto_reject';
    notes.push('Linked from personal index with personal keywords in link text');
  } else if (totalEventScore > 0 && plantTermsArray.length === 0) {
    entry.classification = 'event';
    entry.confidence = 'medium';
    entry.triage_action = 'auto_keep'; // Conference/event material is still valuable
    notes.push('Event/conference related content');
  } else if (entry.source_indexes.length === 0) {
    // Not referenced by any index page — truly unknown
    entry.classification = 'unknown';
    entry.confidence = 'low';
    entry.triage_action = 'review';
    notes.push('Not referenced by any index page');
  } else {
    // Referenced but no clear signal — needs review
    entry.classification = 'uncertain';
    entry.confidence = 'low';
    entry.triage_action = 'review';
    notes.push(`Sources: ${entry.source_indexes.join(', ')}, but no clear classification signal`);
  }

  entry.topic = sourceTopics.size > 0 ? [...sourceTopics].join(', ') : null;
  entry.notes = notes;
}

// ─── Helper: rough plant ID from a term ──────────────────────────────────────
function findPlantId(term) {
  const t = term.toLowerCase();
  const termToId = {
    'fig': 'fig', 'figs': 'fig', 'ichijiku': 'fig',
    'avocado': 'avocado', 'avo': 'avocado',
    'mango': 'mango', 'lychee': 'lychee', 'lichi': 'lychee',
    'banana': 'banana', 'loquat': 'loquat-biwa', 'biwa': 'loquat-biwa',
    'citrus': 'citrus', 'kumquat': 'kumquat', 'kinkan': 'kumquat',
    'persimmon': 'persimmon', 'kaki': 'persimmon',
    'pomegranate': 'pomegranate', 'zakuro': 'pomegranate',
    'papaya': 'papaya', 'guava': 'guava', 'coffee': 'coffee',
    'tangerine': 'tangerine', 'mandarin': 'citrus-(mandarin)',
    'orange': 'orange', 'grapefruit': 'grapefruit', 'pumelo': 'pumelo',
    'rollinia': 'rollinia', 'jackfruit': 'jackfruit',
    'rambutan': 'rambutan', 'mangosteen': 'mangosteen',
    'longan': 'longan', 'starfruit': 'starfruit',
    'jaboticaba': 'jaboticaba', 'surinam cherry': 'surinam-cherry',
    'cherimoya': 'cherimoya', 'atemoya': 'atemoya',
    'passion fruit': 'passion-fruit', 'lilikoi': 'passion-fruit',
    'ohelo': 'poha', 'stone fruit': null,
  };
  return termToId[t] || null;
}

// ─── Step 5: Also find dirs NOT referenced by any index ─────────────────────
console.log('\nStep 5: Finding unreferenced directories...');

const allSourceDirs = new Set(
  readdirSync(SOURCE, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name.toLowerCase())
);

const referencedDirs = new Set([...dirMap.keys()].map(k => k.toLowerCase()));
const unreferencedDirs = [...allSourceDirs].filter(d => !referencedDirs.has(d));
console.log(`  Referenced by index pages: ${referencedDirs.size}`);
console.log(`  Unreferenced (no index page link): ${unreferencedDirs.length}`);

// Step 6: Build summary statistics
const stats = {
  auto_keep:   0,
  auto_reject: 0,
  review:      0,
  plant:       0,
  personal:    0,
  event:       0,
  unknown:     0,
};

for (const entry of dirMap.values()) {
  if (entry.triage_action === 'auto_keep')   stats.auto_keep++;
  if (entry.triage_action === 'auto_reject') stats.auto_reject++;
  if (entry.triage_action === 'review')      stats.review++;
  if (entry.classification === 'plant')      stats.plant++;
  if (entry.classification === 'personal')   stats.personal++;
  if (entry.classification === 'event')      stats.event++;
  if (entry.classification === 'unknown')    stats.unknown++;
}

// Step 7: Write output
const output = {
  generated: new Date().toISOString(),
  stats: {
    index_pages_crawled: rootFiles.length,
    dirs_referenced: dirMap.size,
    dirs_unreferenced: unreferencedDirs.length,
    ...stats,
  },
  index_pages: indexPageData,
  dir_classifications: Object.fromEntries(
    [...dirMap.entries()].sort(([a], [b]) => a.localeCompare(b))
  ),
  unreferenced_dirs: unreferencedDirs.sort(),
};

writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

console.log('\n=== Site Index Crawl Complete ===');
console.log(`Output: ${OUTPUT_FILE}`);
console.log(`\nIndex pages crawled: ${rootFiles.length}`);
console.log(`Dirs referenced by index pages: ${dirMap.size}`);
console.log(`Dirs not referenced: ${unreferencedDirs.length}`);
console.log(`\nClassification breakdown:`);
console.log(`  Auto-keep  (high confidence plant/event):  ${stats.auto_keep}`);
console.log(`  Auto-reject (personal/non-fruit):          ${stats.auto_reject}`);
console.log(`  Needs review:                              ${stats.review}`);
console.log(`\nPlant dirs: ${stats.plant}, Personal: ${stats.personal}, Event: ${stats.event}`);
