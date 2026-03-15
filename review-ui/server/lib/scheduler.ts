import cron from 'node-cron';
import db from './db.js';
import { config } from '../config.js';
import { sendInactivityReminder, sendDailySummary } from '../services/email.js';
import type { DailySummaryStats } from '../types.js';

// ── Inactivity reminder job ───────────────────────────────────────────────────
// Runs at 09:00 every day
// Emails reviewers who haven't been active in REMINDER_INACTIVE_DAYS days
async function inactivityJob(): Promise<void> {
  console.log('[scheduler] Running inactivity reminder job');
  try {
    const days = config.REMINDER_INACTIVE_DAYS;

    const users = db.prepare(`
      SELECT * FROM users
      WHERE role = 'reviewer'
        AND (last_reminded_at IS NULL OR last_reminded_at < datetime('now', '-' || ? || ' days'))
        AND (last_active_at IS NULL OR last_active_at < datetime('now', '-' || ? || ' days'))
    `).all(days, days) as Array<{
      id: number;
      email: string;
      first_name: string;
      last_active_at: string | null;
    }>;

    let sent = 0;
    for (const user of users) {
      const daysSince = user.last_active_at
        ? Math.floor(
            (Date.now() - new Date(user.last_active_at).getTime()) / (1000 * 60 * 60 * 24)
          )
        : days;

      try {
        await sendInactivityReminder(user.email, user.first_name, daysSince);
        db.prepare(`UPDATE users SET last_reminded_at = datetime('now') WHERE id = ?`).run(user.id);
        sent++;
      } catch (err) {
        console.error(`[scheduler] Failed to send reminder to ${user.email}:`, err);
      }
    }

    console.log(`[scheduler] Inactivity reminders sent: ${sent}`);
  } catch (err) {
    console.error('[scheduler] Inactivity job error:', err);
  }
}

// ── Daily summary job ─────────────────────────────────────────────────────────
// Runs at 18:00 every day
async function dailySummaryJob(): Promise<void> {
  console.log('[scheduler] Running daily summary job');
  try {
    const today = new Date().toISOString().split('T')[0];

    // Decision counts by action today
    const actionRows = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM review_decisions
      WHERE date(decided_at) = date('now')
      GROUP BY action
    `).all() as Array<{ action: string; count: number }>;

    const decisions_by_action: Record<string, number> = {};
    for (const row of actionRows) {
      decisions_by_action[row.action] = row.count;
    }

    // Per-reviewer breakdown today (full names)
    const reviewerRows = db.prepare(`
      SELECT u.first_name || ' ' || u.last_name as name, COUNT(*) as count
      FROM review_decisions rd
      JOIN users u ON rd.user_id = u.id
      WHERE date(rd.decided_at) = date('now')
      GROUP BY rd.user_id
      ORDER BY count DESC
    `).all() as Array<{ name: string; count: number }>;

    // Queue progress
    const swipeTotal = (db.prepare(`SELECT COUNT(*) as count FROM review_queue WHERE queue = 'swipe'`).get() as { count: number }).count;
    const swipeCompleted = (db.prepare(`SELECT COUNT(*) as count FROM review_queue WHERE queue = 'swipe' AND status = 'completed'`).get() as { count: number }).count;
    const classifyTotal = (db.prepare(`SELECT COUNT(*) as count FROM review_queue WHERE queue = 'classify'`).get() as { count: number }).count;
    const classifyCompleted = (db.prepare(`SELECT COUNT(*) as count FROM review_queue WHERE queue = 'classify' AND status = 'completed'`).get() as { count: number }).count;

    // New plants created today
    const newPlantsToday = (db.prepare(`
      SELECT COUNT(*) as count FROM new_plant_requests WHERE date(created_at) = date('now')
    `).get() as { count: number }).count;

    // IDK escalations today
    const idkToday = (db.prepare(`
      SELECT COUNT(*) as count FROM review_decisions
      WHERE action = 'idk' AND date(decided_at) = date('now')
    `).get() as { count: number }).count;

    const stats: DailySummaryStats = {
      date: today,
      decisions_by_action,
      by_reviewer: reviewerRows,
      swipe_progress: { completed: swipeCompleted, total: swipeTotal },
      classify_progress: { completed: classifyCompleted, total: classifyTotal },
      new_plants_today: newPlantsToday,
      idk_escalations_today: idkToday,
    };

    await sendDailySummary(stats);
    console.log('[scheduler] Daily summary sent');
  } catch (err) {
    console.error('[scheduler] Daily summary job error:', err);
  }
}

// ── Scheduler startup ─────────────────────────────────────────────────────────
export function startScheduler(): void {
  // Inactivity reminder: 09:00 every day
  cron.schedule('0 9 * * *', () => {
    inactivityJob().catch(err => console.error('[scheduler] inactivityJob uncaught:', err));
  });

  // Daily summary: 18:00 every day
  cron.schedule('0 18 * * *', () => {
    dailySummaryJob().catch(err => console.error('[scheduler] dailySummaryJob uncaught:', err));
  });

  console.log('[scheduler] Scheduled jobs started (inactivity @ 09:00, summary @ 18:00)');
}
