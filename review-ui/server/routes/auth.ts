import { Router } from 'express';
import crypto from 'crypto';
import db from '../lib/db.js';
import { config } from '../config.js';
import * as dal from '../lib/dal.js';
import { sendMagicLink } from '../services/email.js';
import { requireAuth } from '../middleware/index.js';

const router = Router();

// ── Helper: create session and set cookie ────────────────────────────────────
function createSession(res: any, userId: number): string {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    .replace('T', ' ').replace(/\.\d{3}Z$/, '');

  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
  `).run(sessionId, userId, expiresAt);

  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    signed: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  return sessionId;
}

// ── Helper: generate and store magic link ─────────────────────────────────────
function createMagicLink(email: string): string {
  const token = crypto.randomUUID();
  db.prepare(`
    INSERT INTO magic_links (email, token, expires_at)
    VALUES (?, ?, datetime('now', '+15 minutes'))
  `).run(email, token);
  return token;
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, first_name, last_name } = req.body ?? {};
  console.log(`[auth] register attempt: ${email}`);

  if (!email || !first_name || !last_name) {
    res.status(400).json({ error: 'email, first_name, and last_name are required' });
    return;
  }

  // Basic email format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Invalid email format' });
    return;
  }

  const existing = dal.getUserByEmail(email);
  if (existing) {
    console.log(`[auth] register rejected: ${email} already exists`);
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const user = dal.createUser(email, first_name, last_name);
  console.log(`[auth] user created: id=${user.id} email=${email}`);
  const token = createMagicLink(email);
  console.log(`[auth] magic link created for ${email}, sending email`);

  try {
    await sendMagicLink(email, first_name, token);
    console.log(`[auth] magic link email sent to ${email}`);
  } catch (err) {
    console.error('[auth] sendMagicLink error:', err);
  }

  res.json({ message: 'Check your email for a login link' });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email } = req.body ?? {};
  console.log(`[auth] login attempt: ${email}`);

  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }

  const user = dal.getUserByEmail(email);
  if (!user) {
    console.log(`[auth] login rejected: ${email} not found`);
    res.status(404).json({ error: 'No account found for this email. Please register first.' });
    return;
  }

  const token = createMagicLink(email);
  console.log(`[auth] magic link created for ${email}, sending email`);

  try {
    await sendMagicLink(email, user.first_name, token);
    console.log(`[auth] magic link email sent to ${email}`);
  } catch (err) {
    console.error('[auth] sendMagicLink error:', err);
  }

  res.json({ message: 'Check your email for a login link' });
});

// ── GET /api/auth/verify/:token ───────────────────────────────────────────────
router.get('/verify/:token', (req, res) => {
  const { token } = req.params;
  console.log(`[auth] verify token attempt`);

  const link = db.prepare(`
    SELECT * FROM magic_links
    WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token) as { id: number; email: string } | undefined;

  if (!link) {
    console.log(`[auth] verify failed: token not found or expired`);
    res.redirect('/login?error=expired');
    return;
  }

  const user = dal.getUserByEmail(link.email);
  if (!user) {
    console.log(`[auth] verify failed: no user for email ${link.email}`);
    res.redirect('/login?error=expired');
    return;
  }

  // Mark token used
  db.prepare(`UPDATE magic_links SET used = 1 WHERE id = ?`).run(link.id);

  // Create session
  createSession(res, user.id);
  console.log(`[auth] session created for ${link.email} (user id=${user.id})`);

  res.redirect('/swipe');
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', requireAuth, (req, res) => {
  const sessionId = req.signedCookies?.session_id;
  if (sessionId) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }
  res.clearCookie('session_id');
  res.json({ success: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/admin/login ────────────────────────────────────────────────
router.post('/admin/login', (req, res) => {
  const { email, password } = req.body ?? {};
  console.log(`[auth] admin login attempt: ${email}`);

  if (!email || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  if (email !== config.ADMIN_EMAIL || password !== config.ADMIN_PASSWORD) {
    console.log(`[auth] admin login failed: email match=${email === config.ADMIN_EMAIL} password match=${password === config.ADMIN_PASSWORD}`);
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const adminUser = dal.upsertAdminUser(config.ADMIN_EMAIL, 'Admin');
  createSession(res, adminUser.id);
  console.log(`[auth] admin session created for ${email} (user id=${adminUser.id})`);

  res.json({
    user: {
      id: adminUser.id,
      email: adminUser.email,
      first_name: adminUser.first_name,
      last_name: adminUser.last_name,
      role: adminUser.role,
    },
  });
});

export default router;
