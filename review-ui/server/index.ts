import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import { log } from './lib/logger.js';
import { startScheduler } from './lib/scheduler.js';
import { requireAuth, requireAdmin } from './middleware/index.js';
import authRouter from './routes/auth.js';
import queueRouter from './routes/queue.js';
import reviewRouter from './routes/review.js';
import plantsRouter from './routes/plants.js';
import adminRouter from './routes/admin.js';
import leaderboardRouter from './routes/leaderboard.js';
import meRouter from './routes/me.js';
import ocrReviewRouter from './routes/ocr-review.js';
import browseRouter from './routes/browse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Cookie parsing ────────────────────────────────────────────────────────────
app.use(cookieParser(config.COOKIE_SECRET));

// ── Static: images and thumbnails ────────────────────────────────────────────
// The explicit 404 handler after express.static prevents missing files from
// falling through to the SPA catch-all (which would return index.html as 200).
app.use('/images', requireAuth, express.static(config.IMAGE_MOUNT_PATH),
  (_req: Request, res: Response) => res.sendStatus(404));
app.use('/thumbnails', requireAuth, express.static(config.THUMBNAILS_PATH),
  (_req: Request, res: Response) => res.sendStatus(404));
// Serve source content files for OCR image references (content/source/, content/website/)
const contentRoot = path.resolve(config.IMAGE_MOUNT_PATH, '..');
app.use('/content-files', requireAuth, express.static(contentRoot),
  (_req: Request, res: Response) => res.sendStatus(404));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/queue', requireAuth, queueRouter);
app.use('/api/review', requireAuth, reviewRouter);
app.use('/api/plants', requireAuth, plantsRouter);
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);
app.use('/api/leaderboard', requireAuth, leaderboardRouter);
app.use('/api/me', requireAuth, meRouter);
app.use('/api/ocr-review', requireAuth, ocrReviewRouter);
app.use('/api/browse', requireAuth, browseRouter);

// ── Production: serve built client ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const clientDir = path.join(__dirname, '../client');
  app.use(express.static(clientDir));

  // SPA fallback — non-API GET requests get index.html
  app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

// ── Global JSON error handler ─────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const server = app.listen(config.PORT, '0.0.0.0', () => {
  log(`[server] listening on port ${config.PORT}`);
  log(`[server] APP_URL: ${config.APP_URL}`);
  log(`[server] EXTERNAL_URL: ${config.EXTERNAL_URL}`);
  log(`[server] IMAGE_MOUNT_PATH: ${config.IMAGE_MOUNT_PATH}`);
  log(`[server] THUMBNAILS_PATH: ${config.THUMBNAILS_PATH}`);
  log(`[server] DB_PATH: ${config.DB_PATH}`);
  log(`[server] LOG_PATH: ${config.LOG_PATH || '(console only)'}`);
  startScheduler();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`[server] received ${signal}, shutting down gracefully`);
  server.close(() => {
    console.log('[server] closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
