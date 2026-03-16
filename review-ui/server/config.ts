import * as dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const config = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  DB_PATH: requireEnv('DB_PATH'),
  IMAGE_MOUNT_PATH: requireEnv('IMAGE_MOUNT_PATH'),
  APP_URL: requireEnv('APP_URL'),
  EXTERNAL_URL: process.env.EXTERNAL_URL || requireEnv('APP_URL'),
  LOG_PATH: process.env.LOG_PATH || '',
  COOKIE_SECRET: requireEnv('COOKIE_SECRET'),
  ADMIN_EMAIL: requireEnv('ADMIN_EMAIL'),
  ADMIN_PASSWORD: requireEnv('ADMIN_PASSWORD'),
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || 'noreply@hawaiifruit.net',
  REMINDER_INACTIVE_DAYS: parseInt(
    process.env.REMINDER_INACTIVE_DAYS || '3',
    10,
  ),
};
