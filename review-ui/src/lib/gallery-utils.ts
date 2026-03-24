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

export function stripParsedPrefix(filePath: string) {
  return filePath
    .replace(/^content\/pass_01\/assigned\//, '')
    .replace(/^content\/parsed\//, '')
    .replace(/^content\//, '')
    .replace(/#/g, '%23');
}

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
