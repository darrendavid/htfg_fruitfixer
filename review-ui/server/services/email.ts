import nodemailer from 'nodemailer';
import { config } from '../config.js';
import type { DailySummaryStats } from '../types.js';

// Create transport — graceful degradation if SMTP not configured
const transporter = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    })
  : null;

async function send(options: nodemailer.SendMailOptions): Promise<void> {
  if (!transporter) {
    console.log('[email] SMTP not configured — skipping send. Would have sent:');
    console.log(`  To: ${options.to}`);
    console.log(`  Subject: ${options.subject}`);
    // Dev bypass: print magic link URLs from text body if present
    if (options.text) console.log(`  Body preview: ${String(options.text).slice(0, 200)}`);
    return;
  }
  await transporter.sendMail({ from: config.SMTP_FROM, ...options });
}

export async function sendMagicLink(email: string, firstName: string, token: string): Promise<void> {
  const url = `${config.EXTERNAL_URL}/api/auth/verify/${token}`;
  await send({
    to: email,
    subject: 'HTFG Review — Your Login Link',
    html: `
      <p>Hi ${firstName},</p>
      <p>Click the link below to sign in to HTFG Image Review. This link expires in 15 minutes.</p>
      <p><a href="${url}">Sign in to HTFG Review</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
    `,
    text: `Hi ${firstName},\n\nClick the link below to sign in to HTFG Image Review (expires in 15 minutes):\n\n${url}\n\nIf you didn't request this, you can ignore this email.`,
  });
}

export async function sendInactivityReminder(
  email: string,
  firstName: string,
  daysSinceActive: number,
): Promise<void> {
  await send({
    to: email,
    subject: 'HTFG Review — We miss you!',
    html: `
      <p>Hi ${firstName},</p>
      <p>It's been ${daysSinceActive} day${daysSinceActive !== 1 ? 's' : ''} since you last reviewed images on HTFG Image Review.</p>
      <p>Every review helps us organize Hawaii's tropical fruit archive. Come back and help out!</p>
      <p><a href="${config.APP_URL}">Review images now</a></p>
    `,
    text: `Hi ${firstName},\n\nIt's been ${daysSinceActive} day${daysSinceActive !== 1 ? 's' : ''} since you last reviewed images. Come back and help!\n\n${config.APP_URL}`,
  });
}

export async function sendDailySummary(stats: DailySummaryStats): Promise<void> {
  const actionRows = Object.entries(stats.decisions_by_action)
    .map(([action, count]) => `<tr><td style="padding:4px 8px">${action}</td><td style="padding:4px 8px">${count}</td></tr>`)
    .join('');

  const reviewerRows = stats.by_reviewer
    .map(r => `<tr><td style="padding:4px 8px">${r.name}</td><td style="padding:4px 8px">${r.count}</td></tr>`)
    .join('');

  const swipePct = stats.swipe_progress.total > 0
    ? Math.round((stats.swipe_progress.completed / stats.swipe_progress.total) * 100)
    : 0;
  const classifyPct = stats.classify_progress.total > 0
    ? Math.round((stats.classify_progress.completed / stats.classify_progress.total) * 100)
    : 0;

  await send({
    to: config.ADMIN_EMAIL,
    subject: `HTFG Review — Daily Summary ${stats.date}`,
    html: `
      <h2>HTFG Review Daily Summary — ${stats.date}</h2>

      <h3>Decisions by Action</h3>
      <table border="1" cellpadding="0" cellspacing="0">
        <tr><th style="padding:4px 8px">Action</th><th style="padding:4px 8px">Count</th></tr>
        ${actionRows}
      </table>

      <h3>Per-Reviewer Breakdown</h3>
      <table border="1" cellpadding="0" cellspacing="0">
        <tr><th style="padding:4px 8px">Reviewer</th><th style="padding:4px 8px">Reviews</th></tr>
        ${reviewerRows}
      </table>

      <h3>Queue Progress</h3>
      <p>Swipe: ${stats.swipe_progress.completed} / ${stats.swipe_progress.total} (${swipePct}%)</p>
      <p>Classify: ${stats.classify_progress.completed} / ${stats.classify_progress.total} (${classifyPct}%)</p>

      <h3>New Plants Created Today</h3>
      <p>${stats.new_plants_today}</p>

      <h3>IDK Escalations Today</h3>
      <p>${stats.idk_escalations_today}</p>

      <p><a href="${config.APP_URL}/admin">View Admin Dashboard</a></p>
    `,
  });
}
