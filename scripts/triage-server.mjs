/**
 * HTFG Triage Server
 * Local web UI for reviewing HawaiiFruit.Net subdirectories and classifying them as Keep/Reject.
 * Run: node scripts/triage-server.mjs
 * Port: 3737
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cheerio = require('cheerio');

const PORT = 3737;
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SOURCE_DIR = join(ROOT, 'content', 'source', 'HawaiiFruit. Net');
const DECISIONS_FILE = join(ROOT, 'content', 'parsed', 'triage_decisions.json');
const INFERENCES_FILE = join(ROOT, 'content', 'parsed', 'phase4b_inferences.json');
const MANIFEST_FILE = join(ROOT, 'content', 'parsed', 'phase4_image_manifest.json');
const UNCLASSIFIED_DIR = join(ROOT, 'content', 'parsed', 'unclassified', 'images');
const LINK_GRAPH_FILE  = join(ROOT, 'content', 'parsed', 'site_link_graph.json');
const WEBSITE_DIR      = join(ROOT, 'content', 'website');

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
const MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.png':  'image/png',
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.pdf':  'application/pdf',
  '.doc':  'application/octet-stream',
  '.docx': 'application/octet-stream',
  '.ppt':  'application/octet-stream',
  '.pptx': 'application/octet-stream',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
};

function getMime(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Link graph (site index crawler output)
// ---------------------------------------------------------------------------
function loadLinkGraph() {
  if (!existsSync(LINK_GRAPH_FILE)) return null;
  try { return JSON.parse(readFileSync(LINK_GRAPH_FILE, 'utf8')); }
  catch { return null; }
}

function getLinkEntry(dirName, linkGraph) {
  if (!linkGraph) return null;
  const lc = dirName.toLowerCase();
  const key = Object.keys(linkGraph.dir_classifications || {})
    .find(k => k.toLowerCase() === lc);
  return key ? linkGraph.dir_classifications[key] : null;
}

function getLinkContext(dirName, linkGraph) {
  const entry = getLinkEntry(dirName, linkGraph);
  if (!entry) return null;
  return {
    triage_action: entry.triage_action,
    classification: entry.classification,
    confidence: entry.confidence,
    plant_id: entry.plant_id || null,
    notes: entry.notes || [],
    link_texts: (entry.links || []).slice(0, 6).map(l => ({
      source: l.source_index,
      text: l.text,
    })),
  };
}

// Apply auto-keep/auto-reject from link graph to triage_decisions.json for any
// dirs not yet manually decided. Returns count of new decisions applied.
function applyAutoDecisions(linkGraph) {
  if (!linkGraph) return 0;
  const decisions = loadDecisions();
  let count = 0;
  for (const [dirName, entry] of Object.entries(linkGraph.dir_classifications || {})) {
    if (decisions[dirName]) continue; // already decided
    if (entry.triage_action === 'auto_keep' || entry.triage_action === 'auto_reject') {
      decisions[dirName] = {
        action: entry.triage_action === 'auto_keep' ? 'keep' : 'reject',
        decided_at: new Date().toISOString(),
        auto: true,
        classification: entry.classification,
        plant_id: entry.plant_id || null,
        notes: entry.notes || [],
      };
      count++;
    }
  }
  if (count > 0) saveDecisions(decisions);
  return count;
}

// ---------------------------------------------------------------------------
// Decisions persistence
// ---------------------------------------------------------------------------
function loadDecisions() {
  if (!existsSync(DECISIONS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DECISIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveDecisions(decisions) {
  writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------
function getSourceDirs() {
  const entries = readdirSync(WEBSITE_DIR, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = join(WEBSITE_DIR, entry.name);
    let htmlFiles;
    try {
      htmlFiles = readdirSync(dirPath, { withFileTypes: true })
        .filter(f => f.isFile() && /\.(html?|htm)$/i.test(f.name))
        .map(f => f.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch {
      htmlFiles = [];
    }
    if (htmlFiles.length === 0) continue;
    // Prefer index.html > index.htm > first .html > first .htm (alphabetically)
    let mainHtml = null;
    const lc = htmlFiles.map(f => f.toLowerCase());
    if (lc.includes('index.html')) {
      mainHtml = htmlFiles[lc.indexOf('index.html')];
    } else if (lc.includes('index.htm')) {
      mainHtml = htmlFiles[lc.indexOf('index.htm')];
    } else {
      const firstHtml = htmlFiles.find(f => f.toLowerCase().endsWith('.html'));
      const firstHtm  = htmlFiles.find(f => f.toLowerCase().endsWith('.htm'));
      mainHtml = firstHtml || firstHtm;
    }
    dirs.push({ dir: entry.name, main_html: mainHtml, html_files: htmlFiles });
  }
  dirs.sort((a, b) => a.dir.localeCompare(b.dir, undefined, { sensitivity: 'base' }));
  return dirs;
}

// ---------------------------------------------------------------------------
// Inferences lookup (built once on startup)
// ---------------------------------------------------------------------------
function buildInferencesMap() {
  if (!existsSync(INFERENCES_FILE)) return {};
  try {
    const data = JSON.parse(readFileSync(INFERENCES_FILE, 'utf8'));
    const inferences = data.inferences || data;
    const map = {};
    for (const inf of inferences) {
      // path looks like: "HawaiiFruit. Net/DIRNAME/..." or just "DIRNAME/..."
      const pathStr = inf.path || '';
      const parts = pathStr.split('/').filter(Boolean);
      // Strip the "HawaiiFruit. Net" prefix if present
      let dirName = null;
      if (parts[0] === 'HawaiiFruit. Net' && parts.length >= 2) {
        dirName = parts[1];
      } else if (parts.length >= 1) {
        dirName = parts[0];
      }
      if (!dirName) continue;
      const plantId = inf.inferred_plant_id;
      if (!plantId) continue;
      if (!map[dirName]) map[dirName] = new Set();
      map[dirName].add(plantId);
    }
    // Convert Sets to Arrays
    const result = {};
    for (const [k, v] of Object.entries(map)) {
      result[k] = Array.from(v);
    }
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Content extraction with cheerio
// ---------------------------------------------------------------------------
function extractContent(htmlContent) {
  const $ = cheerio.load(htmlContent);
  const title = $('title').text().trim() || '';
  const headings = [];
  $('h1, h2').each((_, el) => {
    const text = $(el).text().trim();
    if (text) headings.push(text);
  });
  // Get body text, strip tags
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const text_preview = bodyText.slice(0, 400);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && links.length < 20) links.push(href);
  });
  return { title, headings, text_preview, links };
}

// ---------------------------------------------------------------------------
// Manifest lookup for rejected dirs
// ---------------------------------------------------------------------------
function getManifestImagesForDir(dirName) {
  if (!existsSync(MANIFEST_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
    const files = data.files || [];
    // Match files whose source contains /DIRNAME/ (case-sensitive dir names)
    const needle = `/${dirName}/`;
    return files
      .filter(f => (f.source || '').includes(needle))
      .map(f => f.dest)
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// API state builder
// ---------------------------------------------------------------------------
function buildState(dirs, decisions, linkGraph) {
  const total = dirs.length;
  const manualConfirmed = Object.values(decisions).filter(d => !d.auto).length;
  const autoPending = Object.values(decisions).filter(d => d.auto).length;

  // Queue = dirs with no decision OR dirs with auto decision (pending human confirmation)
  const queueDirs = dirs.filter(d => {
    const dec = decisions[d.dir];
    if (!dec) return true;    // undecided
    if (dec.auto) return true; // auto-classified, needs confirmation
    return false;             // manually confirmed
  });

  const dirsWithStatus = queueDirs.map(d => {
    const dec = decisions[d.dir];
    return {
      ...d,
      status: dec ? 'auto_decided' : 'undecided',
      auto_decision: dec || null,
      link_context: getLinkContext(d.dir, linkGraph),
    };
  });

  return {
    total,
    queue_size: queueDirs.length,
    manual_confirmed: manualConfirmed,
    auto_pending: autoPending,
    dirs: dirsWithStatus,
  };
}

function findNextUndecided(queueDirs, afterDir) {
  // queueDirs is already filtered to unconfirmed dirs
  let passedCurrent = (afterDir == null);
  for (const d of queueDirs) {
    if (!passedCurrent) {
      if (d.dir === afterDir) passedCurrent = true;
      continue;
    }
    return d.dir;
  }
  if (queueDirs.length > 0 && queueDirs[0].dir !== afterDir) return queueDirs[0].dir;
  return null;
}

// ---------------------------------------------------------------------------
// Embedded UI HTML
// ---------------------------------------------------------------------------
const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HTFG Triage</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f1a;
      color: #e0e0e8;
      height: 100vh;
      display: flex;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    #sidebar {
      width: 280px;
      min-width: 280px;
      background: #1a1a2e;
      border-right: 1px solid #2a2a4a;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #sidebar-header {
      padding: 16px;
      border-bottom: 1px solid #2a2a4a;
    }

    #sidebar-header h1 {
      font-size: 18px;
      font-weight: 700;
      color: #a78bfa;
      letter-spacing: 0.5px;
    }

    #progress-info {
      margin-top: 8px;
      font-size: 13px;
      color: #8888aa;
    }

    #progress-bar-wrap {
      margin-top: 8px;
      height: 4px;
      background: #2a2a4a;
      border-radius: 2px;
      overflow: hidden;
    }

    #progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #6d28d9, #a78bfa);
      width: 0%;
      transition: width 0.3s ease;
    }

    #sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
    }

    #sidebar-content::-webkit-scrollbar { width: 6px; }
    #sidebar-content::-webkit-scrollbar-track { background: transparent; }
    #sidebar-content::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 3px; }

    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #5a5a7a;
      margin-bottom: 6px;
    }

    #current-dir-name {
      font-size: 16px;
      font-weight: 600;
      color: #e0e0f8;
      margin-bottom: 12px;
      word-break: break-all;
    }

    .files-label {
      font-size: 12px;
      color: #8888aa;
      margin-bottom: 4px;
    }

    #file-list {
      list-style: none;
      margin-bottom: 14px;
    }

    #file-list li {
      margin: 2px 0;
    }

    #file-list a {
      color: #93c5fd;
      text-decoration: none;
      font-size: 13px;
      padding: 2px 4px;
      border-radius: 4px;
      display: block;
      transition: background 0.15s;
    }

    #file-list a:hover { background: #2a2a4a; }
    #file-list a.active { background: #3b3b6a; color: #c4b5fd; font-weight: 600; }

    #link-context-block {
      margin-bottom: 10px;
      padding: 8px 10px;
      background: #0f1f18;
      border-radius: 6px;
      border-left: 3px solid #059669;
      font-size: 12px;
    }

    #link-context-block .ctx-label {
      color: #34d399;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .ctx-source {
      color: #6b7280;
      font-size: 11px;
      margin-top: 4px;
    }

    .ctx-text {
      color: #d1fae5;
      margin-left: 8px;
      font-style: italic;
    }

    .ctx-note {
      color: #6ee7b7;
      margin-top: 3px;
    }

    .ctx-no-graph {
      color: #4b5563;
      font-style: italic;
    }

    #inferences-block {
      margin-bottom: 14px;
      padding: 8px 10px;
      background: #16162a;
      border-radius: 6px;
      border-left: 3px solid #7c3aed;
      font-size: 12px;
    }

    #inferences-block .inf-label {
      color: #a78bfa;
      font-weight: 600;
      margin-bottom: 4px;
    }

    #inferences-block .inf-item {
      color: #b8b8d0;
    }

    /* ── Auto-decision banner ── */
    #auto-banner {
      display: none;
      margin-bottom: 10px;
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    #auto-banner.auto-keep {
      background: #0b2016;
      border-left: 3px solid #10b981;
      color: #6ee7b7;
    }
    #auto-banner.auto-reject {
      background: #200b0b;
      border-left: 3px solid #ef4444;
      color: #fca5a5;
    }

    /* ── Plant + Note inputs ── */
    .classify-block { margin-bottom: 12px; }
    .classify-label {
      font-size: 11px;
      color: #6a6a8a;
      margin-bottom: 3px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    #plant-id-input, #note-input {
      width: 100%;
      background: #13132a;
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      color: #e0e0f8;
      padding: 6px 8px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    #plant-id-input:focus, #note-input:focus { border-color: #7c3aed; }
    #note-input { resize: vertical; min-height: 44px; margin-top: 6px; font-size: 12px; }
    #plant-id-input::placeholder, #note-input::placeholder { color: #3a3a5a; }

    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
      margin-bottom: 20px;
    }

    button {
      border: none;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    button:hover { opacity: 0.9; transform: translateY(-1px); }
    button:active { transform: translateY(0); }
    button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    #btn-keep {
      background: linear-gradient(135deg, #059669, #10b981);
      color: white;
    }

    #btn-reject {
      background: linear-gradient(135deg, #dc2626, #ef4444);
      color: white;
    }

    #btn-skip {
      background: #1e1e38;
      color: #6868a0;
      font-size: 13px;
      padding: 8px 16px;
    }

    .kbd-hint {
      font-size: 11px;
      opacity: 0.7;
      background: rgba(255,255,255,0.15);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: monospace;
    }

    .divider {
      border: none;
      border-top: 1px solid #2a2a4a;
      margin: 12px 0;
    }

    #history-section .section-label { margin-bottom: 8px; }

    .history-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      font-size: 12px;
      border-bottom: 1px solid #1e1e38;
    }

    .history-item:last-child { border-bottom: none; }

    .hist-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      min-width: 44px;
      text-align: center;
    }

    .hist-badge.keep { background: #065f46; color: #6ee7b7; }
    .hist-badge.reject { background: #7f1d1d; color: #fca5a5; }
    .hist-badge.skip { background: #1e1e38; color: #6868a0; }

    .hist-name {
      color: #a0a0c0;
      word-break: break-all;
    }

    /* ── Main area ── */
    #main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    #iframe-toolbar {
      background: #16162a;
      border-bottom: 1px solid #2a2a4a;
      padding: 6px 12px;
      font-size: 12px;
      color: #6a6a8a;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #iframe-url {
      color: #8888aa;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #preview-iframe {
      flex: 1;
      border: none;
      background: white;
      width: 100%;
    }

    /* ── Overlay / spinner ── */
    #overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(10, 10, 20, 0.7);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    #overlay.visible { display: flex; }

    .spinner {
      width: 48px;
      height: 48px;
      border: 5px solid #3a3a5a;
      border-top-color: #a78bfa;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Completion screen ── */
    #completion {
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
      color: #e0e0f0;
    }

    #completion.visible { display: flex; }

    #completion h2 { font-size: 28px; color: #a78bfa; }
    #completion p { font-size: 16px; color: #8888aa; }

    .stat-row {
      display: flex;
      gap: 40px;
      margin-top: 8px;
    }

    .stat-box {
      text-align: center;
      padding: 20px 28px;
      background: #1a1a2e;
      border-radius: 12px;
      border: 1px solid #2a2a4a;
    }

    .stat-box .num { font-size: 36px; font-weight: 700; }
    .stat-box .lbl { font-size: 13px; color: #6a6a8a; margin-top: 4px; }
    .stat-box.keep .num { color: #10b981; }
    .stat-box.reject .num { color: #ef4444; }

    /* ── Empty state ── */
    #empty-state {
      display: none;
      padding: 24px 16px;
      color: #5a5a7a;
      font-size: 14px;
      text-align: center;
    }
  </style>
</head>
<body>

<div id="sidebar">
  <div id="sidebar-header">
    <h1>HTFG Triage</h1>
    <div id="progress-info">Loading...</div>
    <div id="progress-bar-wrap"><div id="progress-bar"></div></div>
  </div>
  <div id="sidebar-content">
    <div id="current-section">
      <div class="section-label" style="margin-bottom:8px;">── Current ──</div>
      <div id="current-dir-name">—</div>

      <div id="auto-banner"></div>

      <div class="files-label">Files:</div>
      <ul id="file-list"></ul>

      <div id="link-context-block">
        <div class="ctx-label">Index context:</div>
        <div id="link-context-content"><span class="ctx-no-graph">Loading...</span></div>
      </div>

      <div id="inferences-block" style="display:none;">
        <div class="inf-label">Phase4B matches:</div>
        <div id="inferences-list"></div>
      </div>

      <div class="classify-block">
        <div class="classify-label">Plant / Fruit</div>
        <input id="plant-id-input" type="text" placeholder="e.g. fig, surinam-cherry, mysore-raspberry…" autocomplete="off">
        <textarea id="note-input" placeholder="Note for Phase 4B (optional)…"></textarea>
      </div>

      <div class="action-buttons">
        <button id="btn-keep" disabled>
          ✓ Keep
          <span class="kbd-hint">K</span>
        </button>
        <button id="btn-reject" disabled>
          ✗ Reject
          <span class="kbd-hint">R</span>
        </button>
        <button id="btn-skip" disabled>
          → Skip
          <span class="kbd-hint">S</span>
        </button>
      </div>
    </div>

    <hr class="divider">

    <div id="history-section">
      <div class="section-label">── History ──</div>
      <div id="history-list"></div>
    </div>

    <div id="empty-state">No undecided directories.<br>All done!</div>
  </div>
</div>

<div id="main">
  <div id="iframe-toolbar">
    <span>Viewing:</span>
    <span id="iframe-url">—</span>
  </div>
  <iframe id="preview-iframe" src="about:blank" sandbox="allow-same-origin allow-scripts allow-forms allow-popups"></iframe>
  <div id="completion">
    <h2>🎉 All Done!</h2>
    <p>Every directory has been triaged.</p>
    <div class="stat-row">
      <div class="stat-box keep"><div class="num" id="stat-keep">0</div><div class="lbl">Manually reviewed</div></div>
      <div class="stat-box reject"><div class="num" id="stat-reject">0</div><div class="lbl">Auto-classified</div></div>
    </div>
  </div>
</div>

<div id="overlay"><div class="spinner"></div></div>

<script>
(function () {
  'use strict';

  let state = null;          // { total, queue_size, manual_confirmed, auto_pending, dirs }
  let inferencesMap = {};    // { dirName: [plantId, ...] }
  let currentDir = null;
  let history = [];
  let busy = false;

  const progressInfo      = document.getElementById('progress-info');
  const progressBar       = document.getElementById('progress-bar');
  const currentDirName    = document.getElementById('current-dir-name');
  const fileList          = document.getElementById('file-list');
  const autoBanner        = document.getElementById('auto-banner');
  const linkContextContent= document.getElementById('link-context-content');
  const inferencesBlock   = document.getElementById('inferences-block');
  const inferencesList    = document.getElementById('inferences-list');
  const plantInput        = document.getElementById('plant-id-input');
  const noteInput         = document.getElementById('note-input');
  const btnKeep           = document.getElementById('btn-keep');
  const btnReject         = document.getElementById('btn-reject');
  const btnSkip           = document.getElementById('btn-skip');
  const historyList       = document.getElementById('history-list');
  const emptyState        = document.getElementById('empty-state');
  const iframe            = document.getElementById('preview-iframe');
  const iframeUrl         = document.getElementById('iframe-url');
  const overlay           = document.getElementById('overlay');
  const completion        = document.getElementById('completion');
  const iframeToolbar     = document.getElementById('iframe-toolbar');

  async function init() {
    const [stateRes, infRes] = await Promise.all([
      fetch('/api/state'),
      fetch('/api/inferences'),
    ]);
    state = await stateRes.json();
    inferencesMap = await infRes.json();
    renderProgress();
    renderHistory();
    if (state.dirs.length > 0) loadDir(state.dirs[0]);
    else showCompletion();
  }

  function renderProgress() {
    if (!state) return;
    const confirmed = state.manual_confirmed;
    const total = state.queue_size + confirmed; // total that will need review
    const remaining = state.dirs.length;
    progressInfo.textContent =
      confirmed + ' confirmed · ' + remaining + ' remaining' +
      (state.auto_pending > 0 ? ' (' + state.auto_pending + ' auto-pending)' : '');
    const pct = total > 0 ? (confirmed / total * 100) : 100;
    progressBar.style.width = Math.min(100, pct).toFixed(1) + '%';
  }

  function loadDir(dirObj) {
    currentDir = dirObj;
    currentDirName.textContent = dirObj.dir;

    // Auto-decision banner
    const dec = dirObj.auto_decision;
    if (dec) {
      const isKeep = dec.action === 'keep';
      autoBanner.className = 'auto-' + dec.action;
      autoBanner.style.display = 'block';
      const classLabel = dec.classification ? ' (' + dec.classification + ')' : '';
      const plantLabel = dec.plant_id ? ' → ' + dec.plant_id : '';
      autoBanner.textContent = 'Auto: ' + dec.action.toUpperCase() + classLabel + plantLabel;
    } else {
      autoBanner.style.display = 'none';
    }

    // File list
    fileList.innerHTML = '';
    for (const file of dirObj.html_files) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = '• ' + file;
      if (file === dirObj.main_html) a.classList.add('active');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        fileList.querySelectorAll('a').forEach(el => el.classList.remove('active'));
        a.classList.add('active');
        loadHtml(dirObj.dir, file);
      });
      li.appendChild(a);
      fileList.appendChild(li);
    }

    // Link context
    const ctx = dirObj.link_context;
    if (ctx) {
      let html = '';
      for (const note of (ctx.notes || []))
        html += '<div class="ctx-note">• ' + escapeHtml(note) + '</div>';
      for (const lt of (ctx.link_texts || []))
        if (lt.text) {
          html += '<div class="ctx-source">' + escapeHtml(lt.source) + ':</div>';
          html += '<div class="ctx-text">&ldquo;' + escapeHtml(lt.text) + '&rdquo;</div>';
        }
      linkContextContent.innerHTML = html || '<span class="ctx-no-graph">No context available</span>';
    } else {
      linkContextContent.innerHTML = '<span class="ctx-no-graph">Not referenced by any index page</span>';
    }

    // Phase 4B inferences
    const plants = inferencesMap[dirObj.dir];
    if (plants && plants.length > 0) {
      inferencesBlock.style.display = 'block';
      inferencesList.innerHTML = plants.slice(0, 8).map(p =>
        '<div class="inf-item">• ' + escapeHtml(p) + '</div>'
      ).join('');
    } else {
      inferencesBlock.style.display = 'none';
    }

    // Pre-fill plant input: auto_decision.plant_id > link_context.plant_id > first inference
    const preFill =
      (dec && dec.plant_id) ||
      (ctx && ctx.plant_id) ||
      (plants && plants[0]) || '';
    plantInput.value = preFill;
    noteInput.value = (dec && dec.note) || '';

    btnKeep.disabled = false;
    btnReject.disabled = false;
    btnSkip.disabled = false;
    emptyState.style.display = 'none';

    if (dirObj.main_html) loadHtml(dirObj.dir, dirObj.main_html);
    else { iframe.src = 'about:blank'; iframeUrl.textContent = '(no HTML)'; }
  }

  function loadHtml(dir, file) {
    iframe.src = '/' + dir + '/' + encodeURIComponent(file);
    iframeUrl.textContent = dir + '/' + file;
  }

  async function decide(action) {
    if (busy || !currentDir) return;
    busy = true;
    if (action !== 'skip') {
      overlay.classList.add('visible');
      btnKeep.disabled = true;
      btnReject.disabled = true;
      btnSkip.disabled = true;
    }

    try {
      const payload = {
        dir: currentDir.dir,
        action,
        plant_id: plantInput.value.trim() || null,
        note: noteInput.value.trim() || null,
      };
      const res = await fetch('/api/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (action !== 'skip') {
        // Remove from local queue
        state.dirs = state.dirs.filter(d => d.dir !== currentDir.dir);
        state.manual_confirmed = (state.manual_confirmed || 0) + 1;
        if (currentDir.auto_decision) state.auto_pending = Math.max(0, (state.auto_pending || 1) - 1);
        history.unshift({ dir: currentDir.dir, action, plant_id: payload.plant_id });
        if (history.length > 5) history.pop();
        renderHistory();
        renderProgress();
      }

      if (data.next_undecided) {
        const nextDir = state.dirs.find(d => d.dir === data.next_undecided);
        if (nextDir) loadDir(nextDir);
        else if (state.dirs.length > 0) loadDir(state.dirs[0]);
        else showCompletion();
      } else {
        if (state.dirs.length > 0) loadDir(state.dirs[0]);
        else showCompletion();
      }
    } catch (err) {
      alert('Error: ' + err.message);
      btnKeep.disabled = false;
      btnReject.disabled = false;
      btnSkip.disabled = false;
    } finally {
      busy = false;
      overlay.classList.remove('visible');
    }
  }

  function showCompletion() {
    currentDir = null;
    btnKeep.disabled = true;
    btnReject.disabled = true;
    btnSkip.disabled = true;
    iframe.style.display = 'none';
    iframeToolbar.style.display = 'none';
    completion.classList.add('visible');
    document.getElementById('stat-keep').textContent = state.manual_confirmed || 0;
    document.getElementById('stat-reject').textContent = state.auto_pending || 0;
    emptyState.style.display = 'none';
  }

  function renderHistory() {
    if (history.length === 0) {
      historyList.innerHTML = '<div style="color:#4a4a6a;font-size:12px;">No decisions yet.</div>';
      return;
    }
    historyList.innerHTML = history.map(h => {
      const badge = h.action === 'keep' ? 'KEEP' : h.action === 'reject' ? 'REJECT' : 'SKIP';
      const plant = h.plant_id ? ' <span style="color:#6b7280;font-size:11px;">' + escapeHtml(h.plant_id) + '</span>' : '';
      return '<div class="history-item">' +
        '<span class="hist-badge ' + h.action + '">' + badge + '</span>' +
        '<span class="hist-name">' + escapeHtml(h.dir) + plant + '</span>' +
        '</div>';
    }).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  btnKeep.addEventListener('click', () => decide('keep'));
  btnReject.addEventListener('click', () => decide('reject'));
  btnSkip.addEventListener('click', () => decide('skip'));

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (busy) return;
    if (e.key === 'k' || e.key === 'K') decide('keep');
    if (e.key === 'r' || e.key === 'R') decide('reject');
    if (e.key === 's' || e.key === 'S') decide('skip');
  });

  init().catch(err => {
    progressInfo.textContent = 'Error loading state: ' + err.message;
    console.error(err);
  });
})();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------
function handleRequest(req, res) {
  const urlStr = req.url || '/';
  const qIdx = urlStr.indexOf('?');
  const pathname = qIdx >= 0 ? urlStr.slice(0, qIdx) : urlStr;

  try {
    // GET /
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(UI_HTML);
      return;
    }

    // GET /api/state
    if (req.method === 'GET' && pathname === '/api/state') {
      const decisions = loadDecisions();
      const dirs = getSourceDirs();
      const stateObj = buildState(dirs, decisions, linkGraph);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stateObj));
      return;
    }

    // GET /api/inferences
    if (req.method === 'GET' && pathname === '/api/inferences') {
      const map = buildInferencesMap();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(map));
      return;
    }

    // POST /api/decide
    if (req.method === 'POST' && pathname === '/api/decide') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { dir, action, plant_id, note } = JSON.parse(body);
          if (!dir || !action || !['keep', 'reject', 'skip'].includes(action)) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad request: dir and action (keep|reject|skip) required');
            return;
          }

          const decisions = loadDecisions();
          const dirs = getSourceDirs();
          const dirObj = dirs.find(d => d.dir === dir);
          if (!dirObj) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Directory not found: ' + dir);
            return;
          }

          // Skip — just find the next without saving anything
          if (action === 'skip') {
            const queueDirs = dirs.filter(d => {
              if (d.dir === dir) return false;
              const dec = decisions[d.dir];
              return !dec || dec.auto;
            });
            const next_undecided = findNextUndecided(queueDirs, null);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, next_undecided }));
            return;
          }

          const htmlFile = dirObj.main_html;
          const htmlPath = join(WEBSITE_DIR, dir, htmlFile);
          let decisionRecord;

          const baseRecord = {
            action,
            decided_at: new Date().toISOString(),
            auto: false,
            confirmed: true,
            html_file: htmlFile,
            plant_id: plant_id?.trim() || null,
            note: note?.trim() || null,
          };

          if (action === 'keep') {
            let extracted = { title: '', headings: [], text_preview: '', links: [] };
            if (existsSync(htmlPath)) {
              try {
                const htmlContent = readFileSync(htmlPath, 'utf8');
                extracted = extractContent(htmlContent);
              } catch { /* ignore extraction errors */ }
            }
            decisionRecord = { ...baseRecord, extracted };
          } else {
            // reject — delete unclassified images
            const unclassifiedDirPath = join(UNCLASSIFIED_DIR, dir);
            let unclassified_deleted = false;
            if (existsSync(unclassifiedDirPath)) {
              try {
                rmSync(unclassifiedDirPath, { recursive: true, force: true });
                unclassified_deleted = true;
              } catch { /* continue */ }
            }
            decisionRecord = {
              ...baseRecord,
              unclassified_deleted,
              plant_images_to_review: getManifestImagesForDir(dir),
            };
          }

          decisions[dir] = decisionRecord;
          saveDecisions(decisions);

          // Next in queue (excludes just-confirmed dir and all manually confirmed)
          const queueDirs = dirs.filter(d => {
            if (d.dir === dir) return false;
            const dec = decisions[d.dir];
            return !dec || dec.auto;
          });
          const next_undecided = findNextUndecided(queueDirs, null);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, next_undecided }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal error: ' + err.message);
        }
      });
      return;
    }

    // Static file serving from WEBSITE_DIR
    // Handles all paths not matched above — serves pre-rewritten files directly.
    // Directory requests → try index.html, then index.htm.
    if (req.method === 'GET') {
      let filePath = join(WEBSITE_DIR, decodeURIComponent(pathname));

      // Directory index resolution
      let stat;
      try { stat = statSync(filePath); } catch { stat = null; }

      if (stat && stat.isDirectory()) {
        const htmlIdx = join(filePath, 'index.html');
        const htmIdx  = join(filePath, 'index.htm');
        if (existsSync(htmlIdx))      filePath = htmlIdx;
        else if (existsSync(htmIdx))  filePath = htmIdx;
        else {
          res.writeHead(403, { 'Content-Type': 'text/plain' });
          res.end('Directory listing not supported');
          return;
        }
      }

      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found: ' + pathname);
        return;
      }

      const mime = getMime(filePath);
      const ext = extname(filePath).toLowerCase();
      if (ext === '.html' || ext === '.htm') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(filePath, 'utf8'));
      } else {
        res.writeHead(200, { 'Content-Type': mime });
        res.end(readFileSync(filePath));
      }
      return;
    }

    // 404 fallback
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');

  } catch (err) {
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error: ' + err.message);
    } catch { /* response already sent */ }
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Load link graph once at startup (module-level for handler access)
const linkGraph = loadLinkGraph();

const server = createServer(handleRequest);
server.listen(PORT, '127.0.0.1', () => {
  const dirs = getSourceDirs();

  if (linkGraph) {
    const autoCount = applyAutoDecisions(linkGraph);
    if (autoCount > 0) {
      console.log(`  Auto-applied ${autoCount} decisions from site_link_graph.json`);
    }
    console.log(`  Link graph loaded: ${Object.keys(linkGraph.dir_classifications || {}).length} dirs classified`);
  } else {
    console.log(`  (No site_link_graph.json found — run crawl-site-index.mjs first)`);
  }

  const decisions = loadDecisions();
  const manualConfirmed = Object.values(decisions).filter(d => !d.auto).length;
  const autoPending = Object.values(decisions).filter(d => d.auto).length;
  const queueSize = dirs.filter(d => { const dec = decisions[d.dir]; return !dec || dec.auto; }).length;

  console.log(`HTFG Triage Server running at http://localhost:${PORT}`);
  console.log(`  Website: content/website/ (${dirs.length} dirs with HTML)`);
  console.log(`  Manual confirmed: ${manualConfirmed}, Auto pending: ${autoPending}, Queue: ${queueSize}`);
  console.log(`  Open http://localhost:${PORT} in your browser`);
});
