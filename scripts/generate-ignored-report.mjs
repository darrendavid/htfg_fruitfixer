#!/usr/bin/env node
/**
 * Generate HTML report comparing ignored files against assigned files.
 * Verifies duplicates via MD5 checksums.
 */
import { readdirSync, statSync, createReadStream, writeFileSync, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const IGNORED_DIR = path.join(ROOT, 'content/pass_01/unassigned/ignored');
const ASSIGNED_DIR = path.join(ROOT, 'content/pass_01/assigned');
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']);
const OUTPUT = path.join(ROOT, 'content/pass_01/unassigned/ignored-vs-assigned-report.html');

// Walk directory, build filename+size index
function buildIndex(dir) {
  const index = new Map();
  function walk(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!IMG_EXTS.has(path.extname(e.name).toLowerCase())) continue;
        const sz = statSync(full).size;
        const key = e.name.toLowerCase() + '|' + sz;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(full);
      }
    } catch { /* skip */ }
  }
  walk(dir);
  return index;
}

// MD5 of file
function md5(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve('ERROR'));
  });
}

async function main() {
  console.log('Building assigned index...');
  const assignedIndex = buildIndex(ASSIGNED_DIR);
  console.log(`  ${assignedIndex.size} unique name+size keys`);

  console.log('Scanning ignored files...');
  const ignoredFiles = [];
  function walkIgnored(d) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walkIgnored(full); continue; }
        if (!IMG_EXTS.has(path.extname(e.name).toLowerCase())) continue;
        ignoredFiles.push(full);
      }
    } catch { /* skip */ }
  }
  walkIgnored(IGNORED_DIR);
  console.log(`  ${ignoredFiles.length} ignored files`);

  const rows = [];
  let matched = 0, unmatched = 0, checksumMatch = 0, checksumMismatch = 0;
  const MAX_CHECKSUM = 500;

  for (let i = 0; i < ignoredFiles.length; i++) {
    const igPath = ignoredFiles[i];
    const fname = path.basename(igPath);
    const sz = statSync(igPath).size;
    const key = fname.toLowerCase() + '|' + sz;
    const assignedMatches = assignedIndex.get(key);

    if (assignedMatches && assignedMatches.length > 0) {
      matched++;
      const assignedPath = assignedMatches[0];
      let igHash = '', asHash = '', hashMatch = null;

      if (rows.filter(r => r.hashMatch !== null).length < MAX_CHECKSUM) {
        igHash = await md5(igPath);
        asHash = await md5(assignedPath);
        hashMatch = igHash === asHash;
        if (hashMatch) checksumMatch++; else checksumMismatch++;
      }

      rows.push({
        filename: fname,
        size: sz,
        ignoredPath: path.relative(ROOT, igPath).replace(/\\/g, '/'),
        assignedPath: path.relative(ROOT, assignedPath).replace(/\\/g, '/'),
        igHash, asHash, hashMatch,
      });
    } else {
      unmatched++;
      rows.push({
        filename: fname, size: sz,
        ignoredPath: path.relative(ROOT, igPath).replace(/\\/g, '/'),
        assignedPath: null, igHash: '', asHash: '', hashMatch: null,
      });
    }

    if ((i + 1) % 1000 === 0) console.log(`  processed ${i + 1} / ${ignoredFiles.length}`);
  }

  console.log(`Matched: ${matched} | Unmatched: ${unmatched}`);
  console.log(`Checksums: ${checksumMatch} identical, ${checksumMismatch} mismatch`);

  // Sort by filesize descending
  rows.sort((a, b) => b.size - a.size);

  // ── Generate HTML ─────────────────────────────────────────────────────────
  // Thumbnail path: file:// URL to the ignored image on disk
  function thumbFileUrl(ignoredPath) {
    const abs = path.resolve(ROOT, ignoredPath).replace(/\\/g, '/');
    return `file:///${abs}`;
  }

  const rowsHtml = rows.map((r, i) => {
    const status = r.assignedPath === null ? 'noassign'
      : r.hashMatch === true ? 'match'
      : r.hashMatch === false ? 'mismatch' : 'unchecked';
    const cls = status === 'match' ? 'match' : status === 'mismatch' ? 'mismatch' : status === 'noassign' ? 'noassign' : '';
    const label = status === 'match' ? '✓ Identical'
      : status === 'mismatch' ? '✗ DIFFERENT'
      : status === 'noassign' ? '— No match' : '… unchecked';
    const thumbSrc = thumbFileUrl(r.ignoredPath);
    return `<tr class="${cls}" data-status="${status}">
  <td>${i + 1}</td>
  <td class="thumb-cell"><img src="${esc(thumbSrc)}" loading="lazy" class="thumb" onclick="showFull(this.src)" onerror="this.style.display='none'" /></td>
  <td>${esc(r.filename)}</td>
  <td>${r.size >= 1048576 ? (r.size / 1048576).toFixed(1) + ' MB' : (r.size / 1024).toFixed(0) + ' KB'}</td>
  <td class="path">${esc(r.ignoredPath)}</td>
  <td class="path">${r.assignedPath ? esc(r.assignedPath) : '—'}</td>
  <td class="mono">${r.igHash || '—'}</td>
  <td class="mono">${r.asHash || '—'}</td>
  <td>${label}</td>
</tr>`;
  }).join('\n');

  const uncheckedCount = matched - checksumMatch - checksumMismatch;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ignored vs Assigned — Duplicate Verification Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #f8f9fa; color: #333; padding: 20px; }
  h1 { font-size: 1.3rem; margin-bottom: 4px; }
  .subtitle { font-size: 0.8rem; color: #666; margin-bottom: 12px; }
  .summary { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .summary p { font-size: 0.85rem; margin: 2px 0; }
  .stat { font-weight: 600; }
  .good { color: #16a34a; }
  .bad { color: #dc2626; }
  .neutral { color: #6b7280; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; font-size: 0.75rem; }
  th { background: #f1f5f9; text-align: left; padding: 8px 6px; font-weight: 600; border-bottom: 2px solid #ddd; position: sticky; top: 0; z-index: 1; }
  td { padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: middle; }
  .path { word-break: break-all; max-width: 300px; font-size: 0.65rem; }
  tr:hover { background: #f8fafc; }
  .match { background: #dcfce7; }
  .mismatch { background: #fee2e2; font-weight: 600; }
  .noassign { background: #fef3c7; }
  .mono { font-family: 'SF Mono', Consolas, monospace; font-size: 0.7rem; }
  .filter-bar { margin-bottom: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .filter-bar select, .filter-bar input { font-size: 0.8rem; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; }
  .count { font-size: 0.8rem; color: #666; margin-left: auto; }
  .thumb-cell { width: 60px; padding: 2px; }
  .thumb { width: 56px; height: 42px; object-fit: cover; border-radius: 3px; cursor: pointer; border: 1px solid #ddd; transition: transform 0.1s; }
  .thumb:hover { transform: scale(1.1); border-color: #3b82f6; }
  #overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100; cursor: pointer; justify-content: center; align-items: center; }
  #overlay.active { display: flex; }
  #overlay img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
</style>
</head>
<body>
<h1>Ignored vs Assigned — Duplicate Verification Report</h1>
<p class="subtitle">Generated ${new Date().toISOString()}</p>

<div class="summary">
  <p>Total ignored image files: <span class="stat">${ignoredFiles.length.toLocaleString()}</span></p>
  <p>Matched to assigned (filename + byte size): <span class="stat good">${matched.toLocaleString()}</span></p>
  <p>No match found in assigned/: <span class="stat neutral">${unmatched.toLocaleString()}</span></p>
  <p>MD5 checksums verified (first ${Math.min(MAX_CHECKSUM, matched)}):
    <span class="stat good">${checksumMatch} identical</span>,
    <span class="stat bad">${checksumMismatch} mismatch</span>
  </p>
  ${checksumMismatch === 0 ? '<p style="margin-top:8px"><strong class="good">All verified checksums are identical — these are confirmed exact duplicates.</strong></p>' : ''}
</div>

<div class="filter-bar">
  <label>Filter:</label>
  <select id="statusFilter" onchange="filterRows()">
    <option value="all">All (${rows.length.toLocaleString()})</option>
    <option value="match">✓ Checksum Match (${checksumMatch})</option>
    <option value="mismatch">✗ Checksum Mismatch (${checksumMismatch})</option>
    <option value="noassign">— No Assigned Match (${unmatched})</option>
    <option value="unchecked">… Unchecked (${uncheckedCount})</option>
  </select>
  <input type="text" id="searchBox" placeholder="Search filename..." oninput="filterRows()" style="width:200px" />
  <span class="count" id="visibleCount">${rows.length.toLocaleString()} rows</span>
</div>

<table>
<thead>
<tr>
  <th>#</th>
  <th>Preview</th>
  <th>Filename</th>
  <th>Size</th>
  <th>Ignored Path</th>
  <th>Assigned Match Path</th>
  <th>Ignored MD5</th>
  <th>Assigned MD5</th>
  <th>Status</th>
</tr>
</thead>
<tbody id="tbody">
${rowsHtml}
</tbody>
</table>

<div id="overlay" onclick="this.classList.remove('active')"><img id="overlayImg" /></div>

<script>
function filterRows() {
  const status = document.getElementById('statusFilter').value;
  const search = document.getElementById('searchBox').value.toLowerCase();
  let visible = 0;
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const matchStatus = status === 'all' || tr.dataset.status === status;
    const matchSearch = !search || tr.children[2].textContent.toLowerCase().includes(search);
    const show = matchStatus && matchSearch;
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('visibleCount').textContent = visible.toLocaleString() + ' rows';
}
function showFull(src) {
  document.getElementById('overlayImg').src = src;
  document.getElementById('overlay').classList.add('active');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('overlay').classList.remove('active');
});
</script>
</body>
</html>`;

  writeFileSync(OUTPUT, html);
  console.log(`\nReport: ${OUTPUT}`);
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
