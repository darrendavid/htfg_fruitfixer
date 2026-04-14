#!/usr/bin/env node
/**
 * String similarity search for unmatched orphan directory slugs against
 * the NocoDB Plants table (Canonical_Name, Botanical_Name, Aliases).
 */

import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const line of readFileSync(path.join(ROOT, 'review-ui', '.env'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const API_KEY = process.env.NOCODB_API_KEY;
const BASE_URL = 'https://nocodb.djjd.us';
const TABLE_IDS = JSON.parse(readFileSync(path.join(ROOT, 'content/parsed/nocodb_table_ids.json'), 'utf-8'));

// Levenshtein distance
function lev(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

// Token overlap score (0–1)
function tokenOverlap(a, b) {
  const ta = new Set(a.toLowerCase().split(/[\s\-_(),]+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/[\s\-_(),]+/).filter(Boolean));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.max(ta.size, tb.size, 1);
}

// Combined score: higher = better match
function score(query, target) {
  if (!target) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1.0;
  if (t.includes(q) || q.includes(t)) return 0.9;
  const tok = tokenOverlap(q, t);
  if (tok > 0) return 0.5 + tok * 0.4;
  const dist = lev(q, t);
  const maxLen = Math.max(q.length, t.length);
  return Math.max(0, 1 - dist / maxLen) * 0.5;
}

async function fetchAllPlants() {
  const all = [];
  let offset = 0;
  while (true) {
    const qs = new URLSearchParams({ limit: '500', offset: String(offset), fields: 'Id,Id1,Canonical_Name,Botanical_Name,Aliases' });
    const res = await fetch(`${BASE_URL}/api/v2/tables/${TABLE_IDS.Plants}/records?${qs}`, {
      headers: { 'xc-token': API_KEY },
    });
    const d = await res.json();
    all.push(...d.list);
    if (d.pageInfo?.isLastPage) break;
    offset += d.list.length;
  }
  return all;
}

function bestMatches(query, plants, topN = 3) {
  const slugQuery = query.replace(/[-_()]/g, ' ').trim();
  const results = plants.map(p => {
    const aliases = Array.isArray(p.Aliases)
      ? p.Aliases.join(' ')
      : (p.Aliases || '');
    const fields = [p.Canonical_Name, p.Botanical_Name, p.Id1, aliases];
    const best = Math.max(...fields.map(f => score(slugQuery, f || '')));
    return { plant: p, score: best };
  });
  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}

const SEARCH_SLUGS = [
  'yuzu',
  'dovyalis',
  'canistel',
  'naranjilla',
  'pepino',
  'wax-jambu',
  'pulasan',
  'jujube',
  'carambola',
  'longan',
  'jiringa',
  'peanut-butter-fruit',
  'snake-fruit',
  'button-mangosteen',
  'mamoncillo',
  'lemon-drop-mangosteen',
  'achacha',
  'ackee',
  'Chuo Ume Plum',
];

async function main() {
  const plants = await fetchAllPlants();
  console.log(`Loaded ${plants.length} plants from DB\n`);

  for (const slug of SEARCH_SLUGS) {
    const report = JSON.parse(readFileSync(path.join(ROOT, 'content/audit-reconciliation-report.json'), 'utf-8'));
    const fileCount = report.records.ORPHAN.filter(o => o.pass01_path.split('/')[3] === slug).length;
    const matches = bestMatches(slug, plants);
    const top = matches[0];
    const verdict = top.score >= 0.85 ? '✓ MATCH' : top.score >= 0.5 ? '? POSSIBLE' : '✗ NO MATCH';
    console.log(`${slug} (${fileCount} files) — ${verdict}`);
    matches.slice(0, top.score >= 0.85 ? 1 : 3).forEach(m => {
      console.log(`  [${m.score.toFixed(2)}] ${m.plant.Id1} | ${m.plant.Canonical_Name} | ${m.plant.Botanical_Name || '—'} | aliases: ${m.plant.Aliases || '—'}`);
    });
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
