import path from 'path';
import { existsSync, copyFileSync, unlinkSync, renameSync, readdirSync, statSync } from 'fs';

export const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif']);
export const DOC_EXTS = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt']);

export type WalkEntry = { abs: string; rel: string; fileType: 'image' | 'document' };

export function moveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch {
    // Cross-device link — fall back to copy + delete
    copyFileSync(src, dest);
    unlinkSync(src);
  }
}

export function resolveDestFilename(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = filename;
  let counter = 1;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${stem}_${counter}${ext}`;
    counter++;
  }
  return candidate;
}

export function walkFiles(dir: string, results: WalkEntry[], baseDir: string): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkFiles(full, results, baseDir);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMG_EXTS.has(ext)) results.push({ abs: full, rel: path.relative(baseDir, full), fileType: 'image' });
        else if (DOC_EXTS.has(ext)) results.push({ abs: full, rel: path.relative(baseDir, full), fileType: 'document' });
      }
    }
  } catch { /* skip unreadable dirs */ }
}
