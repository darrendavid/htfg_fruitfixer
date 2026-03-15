/**
 * Phase 1: Build Canonical Plant Registry
 *
 * Merges three data sources from HawaiiFruit. Net:
 * 1. fruit-time.htm — harvest calendar with 100 plants
 * 2. phase1_japanese_citrus.json — 83 Japanese citrus varieties
 * 3. phase1_hwfn_directories.json — classified directory names
 *
 * Outputs: content/parsed/plant_registry.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import * as cheerio from "cheerio";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE = join(ROOT, "content", "source", "HawaiiFruit. Net");
const PARSED = join(ROOT, "content", "parsed");

mkdirSync(PARSED, { recursive: true });

// ── 1. Parse fruit-time.htm ─────────────────────────────────────────────
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseHarvestCalendar() {
  const html = readFileSync(join(SOURCE, "fruit-time.htm"), "utf8");
  const $ = cheerio.load(html);
  const plants = [];

  $("table tr").each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 15) return;

    const numCell = $(cells[0]).text().trim();
    const num = parseInt(numCell, 10);
    if (isNaN(num) || num < 1) return;

    const commonName = $(cells[1]).text().trim();
    const botanicalName = $(cells[2]).text().trim();
    if (!commonName) return;

    // Bold text (class xl37) means "at Kona Station"
    const isBold = $(cells[1]).hasClass("xl37");

    const harvestMonths = [];
    for (let m = 0; m < 12; m++) {
      const val = $(cells[3 + m])
        .text()
        .trim();
      if (val.includes("x")) {
        harvestMonths.push(m + 1);
      }
    }

    plants.push({
      common_name: commonName,
      botanical_name: botanicalName,
      harvest_months: harvestMonths,
      at_kona_station: isBold,
    });
  });

  // Write standalone harvest calendar
  const calendarData = {
    source_file: "content/source/HawaiiFruit. Net/fruit-time.htm",
    note: "Harvest data collected continuously by Ken Love (2001-2002), HTFG-West Hawaii. Bold entries are at Kona Station.",
    plant_count: plants.length,
    plants,
  };
  writeFileSync(
    join(PARSED, "phase1_harvest_calendar.json"),
    JSON.stringify(calendarData, null, 2)
  );
  console.log(`Harvest calendar: ${plants.length} plants extracted`);
  return plants;
}

// ── 2. Load pre-existing parsed data ────────────────────────────────────

function loadCitrus() {
  const data = JSON.parse(
    readFileSync(join(PARSED, "phase1_japanese_citrus.json"), "utf8")
  );
  console.log(`Japanese citrus: ${data.variety_count} varieties loaded`);
  return data.varieties;
}

function loadDirectories() {
  const data = JSON.parse(
    readFileSync(join(PARSED, "phase1_hwfn_directories.json"), "utf8")
  );
  console.log(`Directory scan: ${data.length} directories loaded`);
  return data;
}

// ── 2b. Fix known directory scan misclassifications ─────────────────────

const DIR_OVERRIDES = {
  // hamakinkan = "coastal kumquat", not loquat
  hamakinkan: { canonical_name: "kumquat" },
  // aichipom = Aichi prefecture pomelo/pummelo gallery
  aichipom: { classification: "plant", canonical_name: "pumelo", category: "fruit", aliases: ["Aichi pomelo"] },
  // bowen68 = Bowen mango cultivar (Bowen #68)
  bowen68: { classification: "plant", canonical_name: "mango", category: "fruit", aliases: ["Bowen 68 mango"] },
  // biashop = Bishop (fig variety, common in Big Island)
  biashop: { classification: "plant", canonical_name: "fig", category: "fruit", aliases: ["Bishop fig"] },
  // inmarang = not mango, it's marang (Artocarpus odoratissima)
  inmarang: { canonical_name: "marang", aliases: ["Marang"] },
  // sumohawaii = Sumo citrus (Shiranui tangor) grown in Hawaii
  sumohawaii: { classification: "plant", canonical_name: "citrus", category: "fruit", aliases: ["Sumo citrus Hawaii"] },
  // sumoup = also Sumo citrus related
  sumoup: { classification: "plant", canonical_name: "citrus", category: "fruit", aliases: ["Sumo citrus"] },
  // hamazakuro = pomegranate (zakuro = pomegranate in Japanese)
  hamazakuro: { classification: "plant", canonical_name: "pomegranate", category: "fruit", aliases: ["Hama zakuro", "Japanese pomegranate"] },
  // vsprune = vs prune comparison
  vsprune: { classification: "plant", canonical_name: "plum", category: "fruit", aliases: ["VS Prune"] },
};

function applyDirOverrides(directories) {
  for (const dir of directories) {
    const override = DIR_OVERRIDES[dir.dir_name];
    if (override) {
      Object.assign(dir, override);
      if (override.aliases) {
        dir.aliases = [...(dir.aliases || []), ...override.aliases];
      }
    }
  }
  return directories;
}

// ── 3. Normalize plant name to a canonical slug ─────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\s*\/\s*/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── 4. Build unified registry ───────────────────────────────────────────

function buildRegistry(harvestPlants, citrusVarieties, directories) {
  /** @type {Map<string, object>} slug -> plant record */
  const registry = new Map();

  function getOrCreate(slug, commonName) {
    if (!registry.has(slug)) {
      registry.set(slug, {
        id: slug,
        common_name: commonName,
        botanical_names: [],
        aliases: [],
        category: "fruit",
        harvest_months: [],
        at_kona_station: false,
        sources: [],
        hwfn_directories: [],
      });
    }
    return registry.get(slug);
  }

  function addBotanical(plant, name) {
    const n = name.trim();
    if (n && !plant.botanical_names.includes(n)) {
      plant.botanical_names.push(n);
    }
  }

  function addAlias(plant, name) {
    const n = name.trim();
    if (
      n &&
      n.toLowerCase() !== plant.common_name.toLowerCase() &&
      !plant.aliases.some((a) => a.toLowerCase() === n.toLowerCase())
    ) {
      plant.aliases.push(n);
    }
  }

  // ── From harvest calendar ──
  for (const hp of harvestPlants) {
    const slug = slugify(hp.common_name);
    const plant = getOrCreate(slug, hp.common_name);
    addBotanical(plant, hp.botanical_name);
    plant.harvest_months = hp.harvest_months;
    plant.at_kona_station = hp.at_kona_station;
    if (!plant.sources.includes("fruit-time.htm")) {
      plant.sources.push("fruit-time.htm");
    }

    // Handle slash aliases like "Bread Fruit / Ulu", "Passion fruit / lilikoi"
    if (hp.common_name.includes("/")) {
      for (const part of hp.common_name.split("/")) {
        addAlias(plant, part.trim());
      }
    }
  }

  // ── From directory scan (plant-classified dirs only) ──
  for (const dir of directories) {
    if (dir.classification !== "plant") continue;
    const slug = dir.canonical_name || slugify(dir.dir_name);

    // Try to match to existing plant first
    let matched = registry.get(slug);
    if (!matched) {
      // Check if any existing plant has this as an alias
      for (const [, p] of registry) {
        if (
          p.aliases.some(
            (a) => slugify(a) === slug || slugify(a) === slugify(dir.dir_name)
          )
        ) {
          matched = p;
          break;
        }
      }
    }

    if (matched) {
      if (!matched.hwfn_directories.includes(dir.dir_name)) {
        matched.hwfn_directories.push(dir.dir_name);
      }
      if (!matched.sources.includes("directory-scan")) {
        matched.sources.push("directory-scan");
      }
      for (const alias of dir.aliases || []) {
        addAlias(matched, alias);
      }
    } else {
      // New plant from directory name
      const plant = getOrCreate(slug, dir.dir_name);
      plant.hwfn_directories.push(dir.dir_name);
      plant.sources.push("directory-scan");
      if (dir.category && dir.category !== "topic") {
        plant.category = dir.category;
      }
      for (const alias of dir.aliases || []) {
        addAlias(plant, alias);
      }
    }
  }

  // ── From Japanese citrus list (as varieties under "citrus" parent) ──
  // These are varieties, not top-level plants. We store them as a special citrus entry.
  let citrusEntry = registry.get("citrus");
  if (!citrusEntry) {
    citrusEntry = getOrCreate("citrus", "Citrus");
  }
  if (!citrusEntry.sources.includes("Jcitruslist.htm")) {
    citrusEntry.sources.push("Jcitruslist.htm");
  }

  // Also register distinct citrus species as their own entries
  const citrusSpecies = new Map();
  for (const v of citrusVarieties) {
    const speciesSlug = slugify(v.variety_name);
    // Check if this variety matches an existing top-level plant
    const existing = registry.get(speciesSlug);
    if (existing) {
      addBotanical(existing, v.botanical_name);
      if (!existing.sources.includes("Jcitruslist.htm")) {
        existing.sources.push("Jcitruslist.htm");
      }
      continue;
    }

    // Group by parent species
    const parentKey = v.parent_species || v.botanical_name || "unclassified";
    if (!citrusSpecies.has(parentKey)) {
      citrusSpecies.set(parentKey, []);
    }
    citrusSpecies.get(parentKey).push(v);
  }

  // Attach citrus variety count to the citrus entry
  citrusEntry.japanese_citrus_variety_count = citrusVarieties.length;

  // ── Extract non-plant directories ──
  const nonPlantDirs = directories.filter((d) => d.classification !== "plant");

  return { registry, nonPlantDirs, citrusSpecies };
}

// ── 5. Run ──────────────────────────────────────────────────────────────

const harvestPlants = parseHarvestCalendar();
const citrusVarieties = loadCitrus();
const directories = applyDirOverrides(loadDirectories());

const { registry, nonPlantDirs } = buildRegistry(
  harvestPlants,
  citrusVarieties,
  directories
);

// Clean up common_name for directory-only entries
for (const [, plant] of registry) {
  // If common_name looks like a raw directory slug, try to clean it up
  if (plant.sources.length === 1 && plant.sources[0] === "directory-scan") {
    // Title-case the slug
    plant.common_name = plant.id
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  // Special fixes
  if (plant.id === "citrus" && plant.common_name === "jcitrus") {
    plant.common_name = "Citrus";
  }
}

// Convert registry map to sorted array
const plantArray = [...registry.values()].sort((a, b) =>
  a.id.localeCompare(b.id)
);

const output = {
  generated: new Date().toISOString(),
  description:
    "Phase 1 Canonical Plant Registry - merged from fruit-time.htm harvest calendar, Jcitruslist.htm Japanese citrus, and HawaiiFruit.Net directory scan",
  sources: [
    "content/source/HawaiiFruit. Net/fruit-time.htm",
    "content/source/HawaiiFruit. Net/Jcitruslist.htm",
    "content/source/HawaiiFruit. Net/ (directory names)",
  ],
  plant_count: plantArray.length,
  plants: plantArray,
};

writeFileSync(
  join(PARSED, "plant_registry.json"),
  JSON.stringify(output, null, 2)
);
console.log(`\nPlant registry: ${plantArray.length} plants written`);

// ── Write non-plant directory classification ────────────────────────────

const topicOutput = {
  generated: new Date().toISOString(),
  description:
    "Non-plant directories in HawaiiFruit.Net classified as topic/gallery/unknown",
  directory_count: nonPlantDirs.length,
  directories: nonPlantDirs,
};

writeFileSync(
  join(PARSED, "phase1_nonplant_directories.json"),
  JSON.stringify(topicOutput, null, 2)
);
console.log(`Non-plant directories: ${nonPlantDirs.length} classified`);

// ── Summary stats ───────────────────────────────────────────────────────

const withHarvest = plantArray.filter((p) => p.harvest_months.length > 0);
const withDirs = plantArray.filter((p) => p.hwfn_directories.length > 0);
const withBotanical = plantArray.filter((p) => p.botanical_names.length > 0);

console.log(`\n=== Phase 1 Summary ===`);
console.log(`Total plants in registry: ${plantArray.length}`);
console.log(`  With harvest data:      ${withHarvest.length}`);
console.log(`  With botanical names:   ${withBotanical.length}`);
console.log(`  With HWFN directories:  ${withDirs.length}`);
console.log(`  Non-plant directories:  ${nonPlantDirs.length}`);
