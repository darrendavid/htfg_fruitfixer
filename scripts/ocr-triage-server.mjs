/**
 * OCR Triage Server
 *
 * Web UI for reviewing OCR candidates — images identified by ocr-scan.mjs as
 * likely containing agronomically useful text (posters, data sheets, labels).
 *
 * Left panel:  image metadata + extracted OCR text + action buttons
 * Right panel: the image itself (full-size display)
 *
 * Keyboard shortcuts: K = Keep, R = Reject, S = Skip
 *
 * Input:  content/parsed/ocr_candidates.json  (from ocr-scan.mjs)
 * Output: content/parsed/ocr_decisions.json
 *
 * Usage: node scripts/ocr-triage-server.mjs
 *        node scripts/ocr-triage-server.mjs --port 3738
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 3738;
const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const CANDIDATES_FILE = join(ROOT, 'content', 'parsed', 'ocr_candidates.json');
const DECISIONS_FILE  = join(ROOT, 'content', 'parsed', 'ocr_decisions.json');

// ---------------------------------------------------------------------------
// MIME
// ---------------------------------------------------------------------------
const MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
function loadCandidates() {
  if (!existsSync(CANDIDATES_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(CANDIDATES_FILE, 'utf-8'));
    return data.candidates || [];
  } catch { return []; }
}

function loadDecisions() {
  if (!existsSync(DECISIONS_FILE)) return {};
  try { return JSON.parse(readFileSync(DECISIONS_FILE, 'utf-8')); }
  catch { return {}; }
}

function saveDecisions(decisions) {
  writeFileSync(DECISIONS_FILE, JSON.stringify(decisions, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// State builder
// ---------------------------------------------------------------------------
function buildQueue(candidates, decisions) {
  return candidates.filter(c => !decisions[c.path] || decisions[c.path].action === 'skip');
}

// ---------------------------------------------------------------------------
// UI HTML
// ---------------------------------------------------------------------------
const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>OCR Triage</title>
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

    /* ── Left panel ── */
    #panel {
      width: 360px;
      min-width: 360px;
      background: #1a1a2e;
      border-right: 1px solid #2a2a4a;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #panel-header {
      padding: 14px 16px 10px;
      border-bottom: 1px solid #2a2a4a;
      flex-shrink: 0;
    }

    #panel-header h1 {
      font-size: 17px;
      font-weight: 700;
      color: #a78bfa;
    }

    #progress-info {
      margin-top: 6px;
      font-size: 12px;
      color: #8888aa;
    }

    #progress-bar-wrap {
      margin-top: 6px;
      height: 3px;
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

    #panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    #panel-body::-webkit-scrollbar { width: 5px; }
    #panel-body::-webkit-scrollbar-track { background: transparent; }
    #panel-body::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 3px; }

    /* ── Metadata block ── */
    .meta-block {
      background: #13132a;
      border-radius: 8px;
      padding: 10px 12px;
      border: 1px solid #2a2a4a;
    }

    .meta-filename {
      font-size: 13px;
      font-weight: 600;
      color: #c4b5fd;
      word-break: break-all;
      margin-bottom: 6px;
    }

    .meta-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }

    .badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
    }

    .badge-source-plants   { background: #0b2016; color: #6ee7b7; }
    .badge-source-original { background: #1e1620; color: #c4b5fd; }
    .badge-plant { background: #16162a; color: #93c5fd; border: 1px solid #2a2a4a; }
    .badge-size  { background: #1a1a2e; color: #8888aa; border: 1px solid #2a2a4a; }
    .badge-words { background: #1a1a2e; color: #8888aa; border: 1px solid #2a2a4a; }
    .badge-conf  { background: #1a1a2e; color: #8888aa; border: 1px solid #2a2a4a; }

    .data-words {
      margin-top: 6px;
      font-size: 11px;
      color: #059669;
    }

    .data-words span {
      display: inline-block;
      background: #0b2016;
      border: 1px solid #065f46;
      border-radius: 3px;
      padding: 1px 5px;
      margin: 1px 2px;
      color: #34d399;
    }

    /* ── OCR text block ── */
    .ocr-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #5a5a7a;
      margin-bottom: 4px;
    }

    #ocr-text {
      background: #0d0d1e;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12px;
      line-height: 1.6;
      color: #c8c8e0;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 280px;
      overflow-y: auto;
      font-family: 'Menlo', 'Consolas', monospace;
    }

    #ocr-text::-webkit-scrollbar { width: 5px; }
    #ocr-text::-webkit-scrollbar-track { background: transparent; }
    #ocr-text::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 3px; }

    /* ── Action buttons ── */
    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    button {
      border: none;
      border-radius: 8px;
      padding: 11px 16px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-family: inherit;
    }

    button:hover { opacity: 0.88; transform: translateY(-1px); }
    button:active { transform: translateY(0); }
    button:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

    #btn-keep   { background: linear-gradient(135deg, #059669, #10b981); color: white; }
    #btn-reject { background: linear-gradient(135deg, #dc2626, #ef4444); color: white; }
    #btn-skip   { background: #1e1e38; color: #6868a0; font-size: 13px; padding: 8px 16px; }

    .kbd-hint {
      font-size: 11px;
      opacity: 0.7;
      background: rgba(255,255,255,0.15);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: monospace;
    }

    hr.divider {
      border: none;
      border-top: 1px solid #2a2a4a;
      flex-shrink: 0;
    }

    /* ── History ── */
    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #5a5a7a;
      margin-bottom: 6px;
    }

    .history-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 11px;
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

    .hist-badge.keep   { background: #065f46; color: #6ee7b7; }
    .hist-badge.reject { background: #7f1d1d; color: #fca5a5; }
    .hist-badge.skip   { background: #1e1e38; color: #6868a0; }

    .hist-name { color: #8888aa; word-break: break-all; }

    /* ── Right image area ── */
    #image-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #0b0b14;
      overflow: hidden;
      position: relative;
    }

    #image-toolbar {
      background: #16162a;
      border-bottom: 1px solid #2a2a4a;
      padding: 6px 14px;
      font-size: 12px;
      color: #6a6a8a;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    #image-path-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    #image-counter {
      font-size: 11px;
      color: #4a4a6a;
      flex-shrink: 0;
    }

    #image-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 16px;
    }

    #image-display {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    }

    /* ── Loading / done overlays ── */
    #loading-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(10,10,20,0.7);
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    #loading-overlay.visible { display: flex; }

    .spinner {
      width: 40px; height: 40px;
      border: 4px solid #3a3a5a;
      border-top-color: #a78bfa;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    #completion {
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
    }

    #completion.visible { display: flex; }
    #completion h2 { font-size: 26px; color: #a78bfa; }
    #completion p  { font-size: 15px; color: #8888aa; }

    .stat-row { display: flex; gap: 32px; margin-top: 8px; }

    .stat-box {
      text-align: center;
      padding: 18px 24px;
      background: #1a1a2e;
      border-radius: 10px;
      border: 1px solid #2a2a4a;
    }

    .stat-box .num { font-size: 32px; font-weight: 700; }
    .stat-box .lbl { font-size: 12px; color: #6a6a8a; margin-top: 4px; }
    .stat-box.keep   .num { color: #10b981; }
    .stat-box.reject .num { color: #ef4444; }
  </style>
</head>
<body>

<div id="panel">
  <div id="panel-header">
    <h1>OCR Triage</h1>
    <div id="progress-info">Loading…</div>
    <div id="progress-bar-wrap"><div id="progress-bar"></div></div>
  </div>

  <div id="panel-body">
    <div id="meta-section">
      <div class="meta-block" id="meta-block">
        <div class="meta-filename" id="meta-filename">—</div>
        <div class="meta-row" id="meta-badges"></div>
        <div class="data-words" id="data-words"></div>
      </div>
    </div>

    <div>
      <div class="ocr-label">Extracted Text</div>
      <div id="ocr-text">(none)</div>
    </div>

    <div class="action-buttons">
      <button id="btn-keep" disabled>✓ Keep <span class="kbd-hint">K</span></button>
      <button id="btn-reject" disabled>✗ Reject <span class="kbd-hint">R</span></button>
      <button id="btn-skip" disabled>→ Skip <span class="kbd-hint">S</span></button>
    </div>

    <hr class="divider">

    <div id="history-section">
      <div class="section-label">── History ──</div>
      <div id="history-list"><div style="color:#4a4a6a;font-size:11px;">No decisions yet.</div></div>
    </div>
  </div>
</div>

<div id="image-area">
  <div id="image-toolbar">
    <span id="image-path-label">—</span>
    <span id="image-counter"></span>
  </div>
  <div id="image-container">
    <img id="image-display" src="" alt="" style="display:none;">
    <div id="completion">
      <h2>All Done!</h2>
      <p>All OCR candidates reviewed.</p>
      <div class="stat-row">
        <div class="stat-box keep"><div class="num" id="stat-keep">0</div><div class="lbl">Kept</div></div>
        <div class="stat-box reject"><div class="num" id="stat-reject">0</div><div class="lbl">Rejected</div></div>
      </div>
    </div>
  </div>
  <div id="loading-overlay"><div class="spinner"></div></div>
</div>

<script>
(function () {
  'use strict';

  let queue = [];       // Array of candidate objects (undecided/skipped)
  let currentIdx = 0;
  let history = [];
  let busy = false;
  let kept = 0, rejected = 0;

  const progressInfo   = document.getElementById('progress-info');
  const progressBar    = document.getElementById('progress-bar');
  const metaFilename   = document.getElementById('meta-filename');
  const metaBadges     = document.getElementById('meta-badges');
  const dataWords      = document.getElementById('data-words');
  const ocrText        = document.getElementById('ocr-text');
  const btnKeep        = document.getElementById('btn-keep');
  const btnReject      = document.getElementById('btn-reject');
  const btnSkip        = document.getElementById('btn-skip');
  const historyList    = document.getElementById('history-list');
  const imageDisplay   = document.getElementById('image-display');
  const imagePathLabel = document.getElementById('image-path-label');
  const imageCounter   = document.getElementById('image-counter');
  const loadingOverlay = document.getElementById('loading-overlay');
  const completion     = document.getElementById('completion');

  async function init() {
    const res = await fetch('/api/state');
    const data = await res.json();
    queue = data.queue;
    kept = data.kept;
    rejected = data.rejected;
    renderProgress(data.total);
    if (queue.length > 0) loadCandidate(0);
    else showCompletion();
  }

  function renderProgress(total) {
    const reviewed = kept + rejected;
    const t = total || (reviewed + queue.length);
    const pct = t > 0 ? (reviewed / t * 100) : 100;
    progressInfo.textContent = reviewed + ' reviewed · ' + queue.length + ' remaining';
    progressBar.style.width = Math.min(100, pct).toFixed(1) + '%';
  }

  function loadCandidate(idx) {
    if (idx >= queue.length) { showCompletion(); return; }
    currentIdx = idx;
    const c = queue[idx];

    // Metadata
    metaFilename.textContent = c.filename;
    metaBadges.innerHTML = [
      '<span class="badge badge-source-' + esc(c.source) + '">' + esc(c.source) + '</span>',
      c.plant_id ? '<span class="badge badge-plant">' + esc(c.plant_id) + '</span>' : '',
      '<span class="badge badge-size">' + c.size_kb + ' KB</span>',
      '<span class="badge badge-words">' + c.word_count + ' words</span>',
      '<span class="badge badge-conf">conf: ' + c.confidence + '%</span>',
    ].join('');

    if (c.data_words && c.data_words.length > 0) {
      dataWords.innerHTML = c.data_words.map(w => '<span>' + esc(w) + '</span>').join('');
    } else {
      dataWords.innerHTML = '';
    }

    ocrText.textContent = c.text || '(no text extracted)';

    // Image
    imagePathLabel.textContent = c.rel;
    imageCounter.textContent = (idx + 1) + ' / ' + queue.length;

    imageDisplay.style.display = 'none';
    loadingOverlay.classList.add('visible');

    const img = new Image();
    img.onload = function () {
      imageDisplay.src = img.src;
      imageDisplay.style.display = 'block';
      loadingOverlay.classList.remove('visible');
    };
    img.onerror = function () {
      imageDisplay.style.display = 'none';
      loadingOverlay.classList.remove('visible');
      imagePathLabel.textContent = c.rel + ' (failed to load)';
    };
    img.src = '/api/image?idx=' + c.idx + '&_=' + Date.now();

    btnKeep.disabled = false;
    btnReject.disabled = false;
    btnSkip.disabled = false;
    completion.classList.remove('visible');
  }

  async function decide(action) {
    if (busy || queue.length === 0) return;
    busy = true;
    btnKeep.disabled = true;
    btnReject.disabled = true;
    btnSkip.disabled = true;

    const c = queue[currentIdx];

    try {
      const res = await fetch('/api/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idx: c.idx, action }),
      });
      await res.json();

      if (action !== 'skip') {
        if (action === 'keep') kept++;
        else rejected++;
        history.unshift({ filename: c.filename, action });
        if (history.length > 6) history.pop();
        renderHistory();
        // Remove from queue
        queue.splice(currentIdx, 1);
        renderProgress(kept + rejected + queue.length);
        // Stay at same index (which now points to next item)
        if (currentIdx >= queue.length) currentIdx = Math.max(0, queue.length - 1);
      } else {
        // Skip: advance to next (wrap around)
        currentIdx = (currentIdx + 1) % Math.max(1, queue.length);
      }

      if (queue.length === 0) showCompletion();
      else loadCandidate(currentIdx);
    } catch (err) {
      alert('Error: ' + err.message);
      btnKeep.disabled = false;
      btnReject.disabled = false;
      btnSkip.disabled = false;
    } finally {
      busy = false;
    }
  }

  function showCompletion() {
    imageDisplay.style.display = 'none';
    completion.classList.add('visible');
    document.getElementById('stat-keep').textContent = kept;
    document.getElementById('stat-reject').textContent = rejected;
    btnKeep.disabled = true;
    btnReject.disabled = true;
    btnSkip.disabled = true;
    loadingOverlay.classList.remove('visible');
  }

  function renderHistory() {
    if (history.length === 0) {
      historyList.innerHTML = '<div style="color:#4a4a6a;font-size:11px;">No decisions yet.</div>';
      return;
    }
    historyList.innerHTML = history.map(h =>
      '<div class="history-item">' +
      '<span class="hist-badge ' + h.action + '">' + h.action.toUpperCase() + '</span>' +
      '<span class="hist-name">' + esc(h.filename) + '</span>' +
      '</div>'
    ).join('');
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  btnKeep.addEventListener('click', () => decide('keep'));
  btnReject.addEventListener('click', () => decide('reject'));
  btnSkip.addEventListener('click', () => decide('skip'));

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (busy) return;
    if (e.key === 'k' || e.key === 'K') decide('keep');
    else if (e.key === 'r' || e.key === 'R') decide('reject');
    else if (e.key === 's' || e.key === 'S') decide('skip');
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') decide('skip');
  });

  init().catch(err => {
    progressInfo.textContent = 'Error: ' + err.message;
    console.error(err);
  });
})();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// Load candidates once at startup
const candidates = loadCandidates();
console.log(`Loaded ${candidates.length} OCR candidates from ocr_candidates.json`);

function handleRequest(req, res) {
  const urlStr = req.url || '/';
  const qIdx = urlStr.indexOf('?');
  const pathname = qIdx >= 0 ? urlStr.slice(0, qIdx) : urlStr;
  const query = qIdx >= 0 ? new URLSearchParams(urlStr.slice(qIdx + 1)) : new URLSearchParams();

  try {
    // GET /
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(UI_HTML);
      return;
    }

    // GET /api/state
    // Returns queue (undecided/skipped candidates) + summary counts
    if (req.method === 'GET' && pathname === '/api/state') {
      const decisions = loadDecisions();
      const kept     = Object.values(decisions).filter(d => d.action === 'keep').length;
      const rejected = Object.values(decisions).filter(d => d.action === 'reject').length;

      // Queue = candidates without a final decision (or only skipped)
      const queue = candidates
        .map((c, i) => {
          const dec = decisions[c.path];
          if (dec && dec.action !== 'skip') return null; // already decided
          return {
            idx: i,
            filename: basename(c.path),
            rel: c.rel,
            source: c.source,
            plant_id: c.plant_id || null,
            size_kb: c.size_kb,
            word_count: c.word_count,
            confidence: c.confidence,
            data_words: c.data_words || [],
            text: c.text || '',
          };
        })
        .filter(Boolean);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ total: candidates.length, kept, rejected, queue }));
      return;
    }

    // GET /api/image?idx=N  — serve the image file at candidates[N]
    if (req.method === 'GET' && pathname === '/api/image') {
      const idxStr = query.get('idx');
      const idx = parseInt(idxStr, 10);
      if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Candidate index out of range');
        return;
      }
      const c = candidates[idx];
      const filePath = c.path;
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Image file not found: ' + filePath);
        return;
      }
      const ext = extname(filePath).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(readFileSync(filePath));
      return;
    }

    // POST /api/decide  — { idx, action: 'keep'|'reject'|'skip' }
    if (req.method === 'POST' && pathname === '/api/decide') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { idx, action } = JSON.parse(body);
          if (!['keep', 'reject', 'skip'].includes(action)) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad action: must be keep|reject|skip');
            return;
          }
          if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid idx');
            return;
          }

          const c = candidates[idx];
          const decisions = loadDecisions();

          if (action === 'skip') {
            // Record skip so we don't lose progress, but keep it in queue
            decisions[c.path] = { action: 'skip', decided_at: new Date().toISOString() };
          } else {
            decisions[c.path] = {
              action,
              decided_at: new Date().toISOString(),
              rel: c.rel,
              source: c.source,
              plant_id: c.plant_id || null,
              word_count: c.word_count,
              confidence: c.confidence,
              data_words: c.data_words || [],
            };
          }
          saveDecisions(decisions);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Error: ' + err.message);
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');

  } catch (err) {
    try {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error: ' + err.message);
    } catch { /* already sent */ }
  }
}

const server = createServer(handleRequest);
server.listen(PORT, '127.0.0.1', () => {
  const decisions = loadDecisions();
  const kept     = Object.values(decisions).filter(d => d.action === 'keep').length;
  const rejected = Object.values(decisions).filter(d => d.action === 'reject').length;
  const remaining = candidates.filter(c => {
    const d = decisions[c.path]; return !d || d.action === 'skip';
  }).length;

  console.log(`OCR Triage Server running at http://localhost:${PORT}`);
  console.log(`  Candidates: ${candidates.length}`);
  console.log(`  Kept: ${kept}, Rejected: ${rejected}, Remaining: ${remaining}`);
  console.log(`  Open http://localhost:${PORT} in your browser`);
});
