/**
 * Writes the terrain of the region step's world map, from Natural Earth's
 * 1:50m shaded relief (public domain, https://www.naturalearthdata.com).
 * Run it with `bun run map:generate`, after world-map.ts.
 *
 * The relief is reprojected onto the map (projection.ts) and recentred so
 * flat ground is mid-grey: slopes facing the light are lighter, the others
 * darker. The map blends it over the land with "overlay", which leaves flat
 * ground and the sea as they are, in light and dark mode alike.
 *
 * One image covers the whole world at low resolution. Each region of the
 * seed data (backend/migration/*_seed_category_sets.up.sql) gets a sharper
 * tile of what the map shows when zoomed to it, so the terrain stays crisp
 * there without one huge image in memory. The tiles and the boxes they cover
 * are listed in src/components/relief-tiles.ts.
 */
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fromArrayBuffer } from 'geotiff';
import jpeg from 'jpeg-js';

import { type Box, cameraFor, regionBox, visibleBox, WORLD_BOX } from '../src/domain/map';
import { fromMap } from './projection';
import { seedRegions } from './seed';

const SOURCE = 'https://naciscdn.org/naturalearth/50m/raster/SR_50M.zip';
/** The source's grey for flat ground and the sea. */
const FLAT = 206;
/** How strongly the relief shows: its difference from flat ground is multiplied by this. */
const CONTRAST = 1.6;
const QUALITY = 80;
/** Pixels per map unit of the whole-world image: 2000 × 864. */
const WORLD_RESOLUTION = 2;
/** The widest map a region tile must cover, in points: the map card on a large phone. */
const VIEWPORT = { width: 440, height: 224 };
/** Pixels per point a tile is made for: between 2× and 3× screens. */
const DENSITY = 2.5;
/** The source's own resolution, in pixels per map unit at the equator; finer adds nothing. */
const MAX_RESOLUTION = 12;

const root = new URL('..', import.meta.url).pathname;

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`Couldn't download ${SOURCE}: ${response.status}`);
}
const dir = mkdtempSync(join(tmpdir(), 'lumei-relief-'));
writeFileSync(join(dir, 'relief.zip'), Buffer.from(await response.arrayBuffer()));
execFileSync('unzip', ['-q', '-o', join(dir, 'relief.zip'), 'SR_50M.tif', '-d', dir]);

const file = readFileSync(join(dir, 'SR_50M.tif'));
const tiff = await fromArrayBuffer(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const image = await tiff.getImage();
const sourceWidth = image.getWidth();
const sourceHeight = image.getHeight();
const [source] = (await image.readRasters()) as unknown as [Uint8Array];

/**
 * Reads the source's grey at a longitude and latitude, between its pixels.
 * @returns 0–255, where `FLAT` is flat ground.
 */
const sample = (lon: number, lat: number): number => {
  const sx = Math.min(Math.max(((lon + 180) / 360) * sourceWidth - 0.5, 0), sourceWidth - 1.001);
  const sy = Math.min(Math.max(((90 - lat) / 180) * sourceHeight - 0.5, 0), sourceHeight - 1.001);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const at = (x: number, y: number) => source[y * sourceWidth + x];
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
};

/**
 * Renders the relief of a box of the map to a JPEG file in assets/images/relief/.
 * @param resolution Pixels per map unit.
 * @returns The box actually covered, widened to whole pixels.
 */
const renderTile = (name: string, box: Box, resolution: number): Box => {
  const width = Math.ceil((box.x1 - box.x0) * resolution);
  const height = Math.ceil((box.y1 - box.y0) * resolution);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const point = fromMap(box.x0 + (x + 0.5) / resolution, box.y0 + (y + 0.5) / resolution);
      const grey = point ? 128 + (sample(...point) - FLAT) * CONTRAST : 128;
      const i = (y * width + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = Math.round(Math.min(Math.max(grey, 0), 255));
      pixels[i + 3] = 255;
    }
  }
  writeFileSync(
    join(root, 'assets', 'images', 'relief', `${name}.jpg`),
    jpeg.encode({ data: pixels, width, height }, QUALITY).data,
  );
  console.log(`Wrote ${name}.jpg, ${width}×${height}`);
  return { x0: box.x0, y0: box.y0, x1: box.x0 + width / resolution, y1: box.y0 + height / resolution };
};

const round = (n: number) => Math.round(n * 100) / 100;

const tiles = [{ name: 'world', box: renderTile('world', WORLD_BOX, WORLD_RESOLUTION) }];
for (const { region, countries } of seedRegions()) {
  // What the map shows when zoomed to the region, clamped to the map.
  const camera = cameraFor(regionBox(countries), VIEWPORT);
  const seen = visibleBox(camera, VIEWPORT);
  const box = {
    x0: Math.max(seen.x0, 0),
    y0: Math.max(seen.y0, 0),
    x1: Math.min(seen.x1, WORLD_BOX.x1),
    y1: Math.min(seen.y1, WORLD_BOX.y1),
  };
  const resolution = Math.min(Math.ceil(camera.scale * DENSITY), MAX_RESOLUTION);
  tiles.push({ name: region, box: renderTile(region, box, resolution) });
}

const lines = tiles.map(
  ({ name, box }) =>
    `  {\n    image: require('../../assets/images/relief/${name}.jpg'),\n    box: { x0: ${round(box.x0)}, y0: ${round(box.y0)}, x1: ${round(box.x1)}, y1: ${round(box.y1)} },\n  },`,
);
writeFileSync(
  join(root, 'src', 'components', 'relief-tiles.ts'),
  `// Generated by scripts/relief.ts (\`bun run map:generate\`). Don't edit by hand.

import type { Box } from '@/domain/map';

/**
 * The shaded relief of the region map, in drawing order: the whole world at
 * low resolution, then a sharper tile of each region, covering \`box\` in the
 * map's units.
 */
export const RELIEF_TILES: { image: number; box: Box }[] = [
${lines.join('\n')}
];
`,
);
