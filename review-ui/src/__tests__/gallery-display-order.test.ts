/**
 * Tests for gallery display order logic.
 * Verifies that lightbox navigation in grouped views follows visual order,
 * not the raw flat images array order.
 */
import { describe, it, expect } from 'vitest';

// Reproduce the grouping + display logic from GalleryTab

interface TestImage {
  Id: number;
  File_Path: string;
  Variety_Name?: string;
  Perceptual_Hash?: string;
}

function hammingDistance(h1: string, h2: string): number {
  if (h1.length !== h2.length) return 64;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    const xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    dist += ((xor >> 3) & 1) + ((xor >> 2) & 1) + ((xor >> 1) & 1) + (xor & 1);
  }
  return dist;
}

function groupByVariety(images: TestImage[]): Array<[string, TestImage[]]> {
  const groups: Record<string, TestImage[]> = {};
  for (const img of images) {
    const variety = img.Variety_Name || '(unassigned)';
    if (!groups[variety]) groups[variety] = [];
    groups[variety].push(img);
  }
  return Object.entries(groups).sort((a, b) => {
    if (a[0] === '(unassigned)') return 1;
    if (b[0] === '(unassigned)') return -1;
    return a[0].localeCompare(b[0]);
  });
}

function groupBySimilarity(images: TestImage[]): Array<[string, TestImage[]]> {
  const parent: Record<number, number> = {};
  const find = (x: number): number => { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  images.forEach((img) => { parent[img.Id] = img.Id; });

  const hashed = images.filter((i) => i.Perceptual_Hash);
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      if (hammingDistance(hashed[i].Perceptual_Hash!, hashed[j].Perceptual_Hash!) <= 8) {
        union(hashed[i].Id, hashed[j].Id);
      }
    }
  }

  const clusters: Record<number, TestImage[]> = {};
  for (const img of images) {
    const root = find(img.Id);
    if (!clusters[root]) clusters[root] = [];
    clusters[root].push(img);
  }

  const result: Array<[string, TestImage[]]> = [];
  for (const imgs of Object.values(clusters)) {
    result.push([imgs[0].File_Path, imgs]);
  }
  result.sort((a, b) => {
    const aIdx = images.indexOf(a[1][0]);
    const bIdx = images.indexOf(b[1][0]);
    return aIdx - bIdx;
  });
  return result;
}

function getDisplayImages(
  images: TestImage[],
  viewMode: string,
  groupedImages: Array<[string, TestImage[]]>,
): TestImage[] {
  if (viewMode === 'grid') return images;
  return groupedImages.flatMap(([, imgs]) => imgs);
}

describe('Gallery display order', () => {
  describe('Variety grouping', () => {
    const images: TestImage[] = [
      { Id: 1, File_Path: 'plants/banana/images/cd2.jpg', Variety_Name: 'Chinese Dwarf Double' },
      { Id: 2, File_Path: 'plants/banana/images/h2.jpg', Variety_Name: 'Hapai' },
      { Id: 3, File_Path: 'plants/banana/images/cd3.jpg', Variety_Name: 'Chinese Dwarf Double' },
      { Id: 4, File_Path: 'plants/banana/images/h3.jpg', Variety_Name: 'Hapai' },
      { Id: 5, File_Path: 'plants/banana/images/DSC_0003.jpg', Variety_Name: 'Chinese Dwarf Double' },
    ];

    it('groups images by variety', () => {
      const groups = groupByVariety(images);
      expect(groups.length).toBe(2);
      expect(groups[0][0]).toBe('Chinese Dwarf Double');
      expect(groups[0][1].length).toBe(3);
      expect(groups[1][0]).toBe('Hapai');
      expect(groups[1][1].length).toBe(2);
    });

    it('displayImages follows grouped order, not flat order', () => {
      const groups = groupByVariety(images);
      const display = getDisplayImages(images, 'variety', groups);
      // Should be: CD2, CD3, DSC_0003, H2, H3 (grouped by variety)
      expect(display.map((i) => i.Id)).toEqual([1, 3, 5, 2, 4]);
    });

    it('lightbox navigation follows display order across group boundaries', () => {
      const groups = groupByVariety(images);
      const display = getDisplayImages(images, 'variety', groups);
      // Start at CD2 (display index 0)
      expect(display[0].File_Path).toContain('cd2');
      // Next (index 1) should be CD3, not H2
      expect(display[1].File_Path).toContain('cd3');
      // Next (index 2) should be DSC_0003
      expect(display[2].File_Path).toContain('DSC_0003');
      // Then crosses into Hapai group
      expect(display[3].File_Path).toContain('h2');
    });

    it('grid mode preserves original order', () => {
      const groups = groupByVariety(images);
      const display = getDisplayImages(images, 'grid', groups);
      expect(display.map((i) => i.Id)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('Similarity grouping', () => {
    const images: TestImage[] = [
      { Id: 10, File_Path: 'a.jpg', Perceptual_Hash: '0000000000000000' },
      { Id: 20, File_Path: 'b.jpg', Perceptual_Hash: 'ffffffffffffffff' },
      { Id: 30, File_Path: 'a_copy.jpg', Perceptual_Hash: '0000000000000001' }, // similar to 10
      { Id: 40, File_Path: 'c.jpg', Perceptual_Hash: '8888888888888888' },
      { Id: 50, File_Path: 'b_copy.jpg', Perceptual_Hash: 'fffffffffffffffe' }, // similar to 20
    ];

    it('groups visually similar images together', () => {
      const groups = groupBySimilarity(images);
      // Should have 3 groups: {10,30}, {20,50}, {40}
      const clusterSizes = groups.map(([, imgs]) => imgs.length).sort();
      expect(clusterSizes).toEqual([1, 2, 2]);
    });

    it('displayImages keeps similar images adjacent', () => {
      const groups = groupBySimilarity(images);
      const display = getDisplayImages(images, 'similarity', groups);
      // Images 10 and 30 should be adjacent
      const idx10 = display.findIndex((i) => i.Id === 10);
      const idx30 = display.findIndex((i) => i.Id === 30);
      expect(Math.abs(idx10 - idx30)).toBe(1);
      // Images 20 and 50 should be adjacent
      const idx20 = display.findIndex((i) => i.Id === 20);
      const idx50 = display.findIndex((i) => i.Id === 50);
      expect(Math.abs(idx20 - idx50)).toBe(1);
    });

    it('groups stay in place after member deletion', () => {
      const groups = groupBySimilarity(images);
      // Remove image 30 (similar to 10)
      const remaining = images.filter((i) => i.Id !== 30);
      const newGroups = groupBySimilarity(remaining);
      const display = getDisplayImages(remaining, 'similarity', newGroups);
      // Image 10 should still be in roughly the same position (first group)
      expect(display[0].Id).toBe(10);
    });
  });

  describe('Shift+click range selection uses display order', () => {
    it('selects correct range in variety view', () => {
      const images: TestImage[] = [
        { Id: 1, File_Path: 'cd2.jpg', Variety_Name: 'Chinese Dwarf Double' },
        { Id: 2, File_Path: 'h2.jpg', Variety_Name: 'Hapai' },
        { Id: 3, File_Path: 'cd3.jpg', Variety_Name: 'Chinese Dwarf Double' },
      ];
      const groups = groupByVariety(images);
      const display = getDisplayImages(images, 'variety', groups);
      // display order: [1(cd2), 3(cd3), 2(h2)]
      // Shift+click from index 0 to index 1 should select IDs 1 and 3
      const start = 0;
      const end = 1;
      const rangeIds = display.slice(start, end + 1).map((i) => i.Id);
      expect(rangeIds).toEqual([1, 3]); // NOT [1, 2]
    });
  });
});
