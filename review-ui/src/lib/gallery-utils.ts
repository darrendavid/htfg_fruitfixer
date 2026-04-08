/** Hamming distance between two hex hash strings */
export function hammingDistance(h1: string, h2: string): number {
  if (h1.length !== h2.length) return 64;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    // Count bits in nibble
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return dist;
}

/**
 * Strip all known path prefixes to get the path relative to IMAGE_MOUNT_PATH.
 * Input could be: content/pass_01/assigned/slug/images/file.jpg
 *                 content/parsed/plants/slug/images/file.jpg
 *                 pass_01/assigned/slug/images/file.jpg
 *                 assigned/slug/images/file.jpg
 *                 plants/slug/images/file.jpg
 *                 slug/images/file.jpg
 * Output should be: slug/images/file.jpg
 */
export function toRelativeImagePath(filePath: string): string {
  return filePath
    .replace(/^content\/pass_01\/assigned\//, '')
    .replace(/^content\/parsed\//, '')
    .replace(/^content\//, '')
    .replace(/^pass_01\/assigned\//, '')
    .replace(/^assigned\//, '')
    .replace(/^plants\//, '')
    .replace(/^unclassified\/images\//, 'unclassified/images/')  // keep unclassified prefix
    .replace(/#/g, '%23');
}

/** Build a full /images/ URL from any file path format */
export function buildImageUrl(filePath: string): string {
  return `/images/${toRelativeImagePath(filePath)}`;
}

/** @deprecated Use toRelativeImagePath instead */
export const stripParsedPrefix = toRelativeImagePath;

export function rotationStyle(deg: number | undefined | null): React.CSSProperties {
  const d = ((deg ?? 0) % 360 + 360) % 360;
  if (d === 0) return {};
  return { transform: `rotate(${d}deg)`, transformOrigin: 'center center' };
}

export function rotationClass(deg: number | undefined | null): string {
  const d = ((deg ?? 0) % 360 + 360) % 360;
  if (d === 90) return 'rotate-90';
  if (d === 180) return 'rotate-180';
  if (d === 270) return '-rotate-90';
  return '';
}

/**
 * Convert a content/pass_01/ file path to a usable image URL.
 * Works for assigned/, unassigned/, and other content paths.
 */
export function imgUrlFromFilePath(filePath: string): string {
  const encode = (p: string) => p.split('/').map(s => encodeURIComponent(s)).join('/');
  if (filePath.startsWith('content/pass_01/assigned/'))
    return `/images/${encode(filePath.replace('content/pass_01/assigned/', ''))}`;
  if (filePath.startsWith('content/pass_01/unassigned/'))
    return `/unassigned-images/${encode(filePath.replace('content/pass_01/unassigned/', ''))}`;
  return `/content-files/${encode(filePath.replace(/^content\//, ''))}`;
}

export const CLASSIFY_GRID_CLASSES = {
  lg: 'grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2',
  md: 'grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-8 gap-2',
  sm: 'grid grid-cols-8 sm:grid-cols-10 lg:grid-cols-12 gap-2',
} as const;
