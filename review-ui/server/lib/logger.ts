import fs from 'fs';
import { config } from '../config.js';

const logStream = config.LOG_PATH
  ? fs.createWriteStream(config.LOG_PATH, { flags: 'a' })
  : null;

export function log(line: string): void {
  const entry = `[${new Date().toISOString()}] ${line}`;
  process.stdout.write(entry + '\n');
  logStream?.write(entry + '\n');
}
