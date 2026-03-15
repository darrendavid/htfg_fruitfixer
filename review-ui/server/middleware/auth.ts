import type { Request, Response, NextFunction } from 'express';
import db from '../lib/db.js';

// requireAuth: validates session cookie, attaches req.user
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionId = req.signedCookies?.session_id;
  if (!sessionId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const row = db.prepare(`
    SELECT s.id as session_id, s.expires_at,
           u.id, u.email, u.first_name, u.last_name, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).get(sessionId) as any;

  if (!row) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  req.user = {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
  };
  next();
}

// requireAdmin: use AFTER requireAuth
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// optionalAuth: sets req.user if session exists, otherwise sets undefined and continues
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const sessionId = req.signedCookies?.session_id;
  if (!sessionId) {
    req.user = undefined;
    next();
    return;
  }

  const row = db.prepare(`
    SELECT s.id as session_id, s.expires_at,
           u.id, u.email, u.first_name, u.last_name, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).get(sessionId) as any;

  req.user = row ? {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
  } : undefined;
  next();
}
