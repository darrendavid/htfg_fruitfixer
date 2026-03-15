import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const PARSED_DIR = join(import.meta.dirname, '..', 'content', 'parsed');
const registryPath = join(PARSED_DIR, 'plant_registry.json');

const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

// Results from the 4 parallel batch scans of content/source/original/
const batchResults = [
  // Batch 1: A-B
  { dir: "abiu", type: "plant", id: "abiu" },
  { dir: "acerola", type: "plant", id: "acerola" },
  { dir: "aglia spp", type: "plant", id: null, canonical: "Aglia", botanical: "Aglaia spp.", category: "fruit", notes: "Genus of tropical fruit trees" },
  { dir: "akee", type: "plant", id: "akee" },
  { dir: "alien labels", type: "topic" },
  { dir: "alupag", type: "plant", id: "alupag" },
  { dir: "amazon tree grape", type: "plant", id: null, canonical: "Amazon Tree Grape", botanical: "Pourouma cecropiifolia", category: "fruit" },
  { dir: "anchote", type: "plant", id: null, canonical: "Anchote", botanical: "Coccinia abyssinica", category: "other" },
  { dir: "annona reticulata", type: "plant", id: null, canonical: "Custard Apple", botanical: "Annona reticulata", category: "fruit", aliases: ["Bullock's Heart"] },
  { dir: "apple of sodom", type: "plant", id: null, canonical: "Apple of Sodom", botanical: "Solanum incanum", category: "fruit" },
  { dir: "assai palm", type: "plant", id: null, canonical: "Açaí Palm", botanical: "Euterpe oleracea", category: "fruit", aliases: ["Assai", "Acai"] },
  { dir: "atamoya", type: "plant", id: "atamoya" },
  { dir: "avocados", type: "plant", id: "avocado" },
  { dir: "baccaurea sapida", type: "plant", id: null, canonical: "Baccaurea", botanical: "Baccaurea sapida", category: "fruit" },
  { dir: "bael fruit", type: "plant", id: null, canonical: "Bael Fruit", botanical: "Aegle marmelos", category: "fruit" },
  { dir: "bags\"kohi", type: "topic" },
  { dir: "bakupari", type: "plant", id: null, canonical: "Bakupari", botanical: "Garcinia gardneriana", category: "fruit" },
  { dir: "banana pokka", type: "plant", id: null, canonical: "Banana Poka", botanical: "Passiflora tarminiana", category: "fruit", aliases: ["Banana Passion Fruit"] },
  { dir: "bananas", type: "plant", id: "banana" },
  { dir: "Bananaspapaya", type: "topic", notes: "Mixed banana and papaya content" },
  { dir: "barringtonia edulis", type: "plant", id: null, canonical: "Barringtonia", botanical: "Barringtonia edulis", category: "fruit", aliases: ["Cut Nut"] },
  { dir: "betel nuts", type: "plant", id: null, canonical: "Betel Nut", botanical: "Areca catechu", category: "nut" },
  { dir: "bignay", type: "plant", id: "bignay" },
  { dir: "bilimbi", type: "plant", id: "bilimbi" },
  { dir: "biwa file", type: "plant", id: "loquat-biwa" },
  { dir: "black pepper", type: "plant", id: null, canonical: "Black Pepper", botanical: "Piper nigrum", category: "spice" },
  { dir: "blackberryjam", type: "plant", id: null, canonical: "Blackberry Jam Fruit", botanical: "Randia formosa", category: "fruit" },
  { dir: "blancoi", type: "plant", id: "a-blancoi" },

  // Batch 2: B-E
  { dir: "blk surinam cherry", type: "plant", id: "surinam-cherry" },
  { dir: "buddahs hand", type: "plant", id: "buddhas-hand" },
  { dir: "cacao files", type: "plant", id: "cacao" },
  { dir: "calabash tree", type: "plant", id: null, canonical: "Calabash Tree", botanical: "Crescentia cujete", category: "fruit" },
  { dir: "calamondin files", type: "plant", id: "calamondin" },
  { dir: "cannonball tree", type: "plant", id: "cannonball-tree" },
  { dir: "cashew09", type: "plant", id: "cashew-apple" },
  { dir: "champedek", type: "plant", id: null, canonical: "Champedak", botanical: "Artocarpus integer", category: "fruit" },
  { dir: "cherimoya", type: "plant", id: "cherimoya" },
  { dir: "chico", type: "plant", id: "chico" },
  { dir: "chili sauce", type: "topic" },
  { dir: "choco sapote", type: "plant", id: null, canonical: "Chocolate Sapote", botanical: "Diospyros nigra", category: "fruit", aliases: ["Black Sapote"] },
  { dir: "choice mart\"mobi signs", type: "topic" },
  { dir: "chupachupa", type: "plant", id: null, canonical: "Chupa Chupa", botanical: "Quararibea cordata", category: "fruit" },
  { dir: "citrus poster start", type: "topic" },
  { dir: "coffeepix", type: "plant", id: "coffee" },
  { dir: "coffees", type: "plant", id: "coffee" },
  { dir: "cupasau", type: "plant", id: null, canonical: "Cupuaçu", botanical: "Theobroma grandiflorum", category: "fruit", aliases: ["Cupuassu", "Cupasau"] },
  { dir: "date farm", type: "plant", id: null, canonical: "Date Palm", botanical: "Phoenix dactylifera", category: "fruit" },
  { dir: "datepalms", type: "plant", id: null, canonical: "Date Palm", botanical: "Phoenix dactylifera", category: "fruit" },
  { dir: "deannafig 09", type: "plant", id: "fig" },
  { dir: "Dimocarpus longan subsp. malesianus var. echinatus", type: "plant", id: "longon" },
  { dir: "dovylis", type: "plant", id: null, canonical: "Dovyalis", botanical: "Dovyalis spp.", category: "fruit", aliases: ["Kei Apple", "Tropical Apricot"] },
  { dir: "dragon fruit  files", type: "plant", id: "dragon-fruit-pitaya" },
  { dir: "dragon fruit pix", type: "plant", id: "dragon-fruit-pitaya" },
  { dir: "Durian products'", type: "topic" },
  { dir: "durian", type: "plant", id: "durian" },
  { dir: "eggfruit", type: "plant", id: "egg-fruit" },
  { dir: "emblic", type: "plant", id: null, canonical: "Emblic", botanical: "Phyllanthus emblica", category: "fruit", aliases: ["Amla", "Indian Gooseberry"] },
  { dir: "emperor lychee", type: "plant", id: "lychee" },
  { dir: "Eugenia uvalha", type: "plant", id: null, canonical: "Uvaia", botanical: "Eugenia uvalha", category: "fruit" },

  // Batch 3: F-G
  { dir: "fig troubles", type: "topic" },
  { dir: "figs", type: "plant", id: "fig" },
  { dir: "figs  green", type: "plant", id: "fig" },
  { dir: "FIJIAN longon", type: "plant", id: "fijian-longon" },
  { dir: "fijian longon2", type: "plant", id: "fijian-longon" },
  { dir: "fingerlimes", type: "plant", id: null, canonical: "Finger Lime", botanical: "Citrus australasica", category: "fruit" },
  { dir: "flowers", type: "topic" },
  { dir: "frankies", type: "plant", id: null, canonical: "Frankie", botanical: null, category: "fruit", notes: "Unknown plant - needs human review" },
  { dir: "frankies 6-07", type: "plant", id: null, canonical: "Frankie", botanical: null, category: "fruit" },
  { dir: "freijoa folder", type: "plant", id: null, canonical: "Feijoa", botanical: "Acca sellowiana", category: "fruit", aliases: ["Pineapple Guava", "Freijoa"] },
  { dir: "fruit display", type: "topic" },
  { dir: "fruit pix", type: "topic" },
  { dir: "fruit pix 5-17", type: "topic" },
  { dir: "fruit pix on power hd", type: "topic" },
  { dir: "fruit shoot", type: "topic" },
  { dir: "fruit trees", type: "topic" },
  { dir: "galangal", type: "plant", id: null, canonical: "Galangal", botanical: "Alpinia galanga", category: "spice" },
  { dir: "gentum", type: "plant", id: null, canonical: "Gnetum", botanical: "Gnetum gnemon", category: "fruit", aliases: ["Melinjo", "Gentum"] },
  { dir: "giant passionflower", type: "plant", id: null, canonical: "Giant Passionflower", botanical: "Passiflora quadrangularis", category: "fruit", aliases: ["Giant Granadilla"] },
  { dir: "giant tangerine", type: "plant", id: "tangerine" },
  { dir: "glass company", type: "topic" },
  { dir: "gourka", type: "plant", id: "garcinia-gourka" },
  { dir: "gov plum files", type: "plant", id: "governors-plum" },
  { dir: "grapefruit", type: "plant", id: "grapefruit" },
  { dir: "green sapote", type: "plant", id: "green-sapote" },
  { dir: "grumi", type: "plant", id: "grumichama" },
  { dir: "grumichama\"tart", type: "plant", id: "grumichama" },
  { dir: "guarana", type: "plant", id: null, canonical: "Guarana", botanical: "Paullinia cupana", category: "fruit" },
  { dir: "guava folder", type: "plant", id: "guava" },

  // Batch 4: M-Z + dates
  { dir: "mango gold nugget ", type: "plant", id: "mango" },
  { dir: "monkey jack copy", type: "plant", id: null, canonical: "Monkey Jack", botanical: "Artocarpus lacucha", category: "fruit" },
  { dir: "pickle lables", type: "topic" },
  { dir: "plantains copy", type: "plant", id: "banana", notes: "Plantains are cooking bananas" },
  { dir: "raisen tree copy", type: "plant", id: null, canonical: "Raisin Tree", botanical: "Hovenia dulcis", category: "fruit", aliases: ["Japanese Raisin Tree"] },
  { dir: "rambutan 9-17-10", type: "plant", id: "rambutan" },
  { dir: "rukam copy", type: "plant", id: null, canonical: "Rukam", botanical: "Flacourtia rukam", category: "fruit" },
  { dir: "05Fruitshoot", type: "topic" },
  { dir: "2003 fruit shoot 2003", type: "topic" },
  { dir: "2005 fruit shoot", type: "topic" },
  { dir: "2007 fruit shoot", type: "topic" },
  { dir: "2008 fruit shoot", type: "topic" },
  { dir: "2009 fruit shoot", type: "topic" },
  { dir: "2009 fruit shoot to UPLU", type: "topic" },
  { dir: "2011 fruit shoot", type: "topic" },
  { dir: "2012 fruitshoot ", type: "topic" },
  { dir: "2019 fruit shoot two", type: "topic" },
  { dir: "2020 fruit shoot", type: "topic" },
  { dir: "2-4 pix", type: "topic" },
  { dir: "5-07 pix", type: "topic" },
];

// Separate into plants with existing matches, new plants, and topics
const existingMatches = batchResults.filter(r => r.type === 'plant' && r.id);
const newPlants = batchResults.filter(r => r.type === 'plant' && !r.id);
const topics = batchResults.filter(r => r.type === 'topic');

// 1. Add original_directories to existing plants
for (const match of existingMatches) {
  const plant = registry.plants.find(p => p.id === match.id);
  if (plant) {
    if (!plant.original_directories) plant.original_directories = [];
    if (!plant.original_directories.includes(match.dir)) {
      plant.original_directories.push(match.dir);
    }
    if (!plant.sources.includes('original-directory-scan')) {
      plant.sources.push('original-directory-scan');
    }
  } else {
    console.warn(`WARNING: No plant found for id "${match.id}" (dir: ${match.dir})`);
  }
}

// 2. Add new plants
// Group by canonical name to merge duplicate dirs (e.g. date farm + datepalms)
const newPlantsByName = {};
for (const np of newPlants) {
  const key = np.canonical;
  if (!newPlantsByName[key]) {
    newPlantsByName[key] = {
      canonical: np.canonical,
      botanical: np.botanical,
      category: np.category || 'fruit',
      aliases: np.aliases || [],
      dirs: [np.dir],
      notes: np.notes || null,
    };
  } else {
    newPlantsByName[key].dirs.push(np.dir);
  }
}

for (const [name, data] of Object.entries(newPlantsByName)) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // Check not already in registry
  if (registry.plants.find(p => p.id === id)) {
    console.warn(`Skipping "${name}" - id "${id}" already exists`);
    continue;
  }
  registry.plants.push({
    id,
    common_name: name,
    botanical_names: data.botanical ? [data.botanical] : [],
    aliases: data.aliases,
    category: data.category,
    harvest_months: [],
    at_kona_station: false,
    sources: ['original-directory-scan'],
    hwfn_directories: [],
    original_directories: data.dirs,
    ...(data.notes ? { notes: data.notes } : {}),
  });
}

// Update metadata
registry.sources.push('content/source/original/ (directory names)');
registry.generated = new Date().toISOString();
registry.description = 'Phase 1 Canonical Plant Registry - merged from fruit-time.htm, Jcitruslist.htm, HawaiiFruit.Net directory scan, and original/ directory scan';
registry.plant_count = registry.plants.length;

// Sort plants by id
registry.plants.sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(registryPath, JSON.stringify(registry, null, 2));

// Also save the non-plant directories classification
const topicsPath = join(PARSED_DIR, 'phase1_original_topics.json');
writeFileSync(topicsPath, JSON.stringify({
  generated: new Date().toISOString(),
  description: 'Non-plant directories in content/source/original/ classified as topics',
  count: topics.length,
  directories: topics.map(t => ({
    dir_name: t.dir,
    notes: t.notes || null,
  })),
}, null, 2));

// Print summary
const matchCount = existingMatches.length;
const newCount = Object.keys(newPlantsByName).length;
console.log(`\n=== Phase 1 Original Directory Merge Complete ===`);
console.log(`Existing plants matched: ${matchCount} directories -> ${new Set(existingMatches.map(m => m.id)).size} plants`);
console.log(`New plants added: ${newCount}`);
console.log(`Topics (non-plant): ${topics.length}`);
console.log(`Total plants in registry: ${registry.plant_count}`);
