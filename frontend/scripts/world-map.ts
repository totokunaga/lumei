/**
 * Writes src/domain/world-map.json, the world map of the region step, from
 * Natural Earth's 1:10m countries (public domain,
 * https://www.naturalearthdata.com). Run it with `bun run map:generate`.
 *
 * Each country becomes an SVG path in the map's projection (projection.ts),
 * simplified to what the map can show when zoomed in on a region, plus the
 * box the map zooms to when the country is highlighted: its mainland, i.e.
 * its largest landmass and the large landmasses near it. That keeps France to
 * Europe (not French Guiana or Réunion) and the US to the lower 48 states
 * (not Alaska or Hawaii), while keeping all of Japan's main islands.
 */
/// <reference types="node" />
import { writeFileSync } from 'node:fs';

import { HEIGHT, toMap, WIDTH } from './projection';
import { seedRegions } from './seed';

const DATA = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson';
const SOURCE = `${DATA}/ne_10m_admin_0_countries.geojson`;
const LAKES = `${DATA}/ne_10m_lakes.geojson`;
const DISPUTED = `${DATA}/ne_10m_admin_0_disputed_areas.geojson`;
/**
 * Disputed areas shown as their administrator's, following the position of
 * the region's own government: Japan holds there is no dispute over the
 * Senkaku Islands, which Natural Earth calls Nansei-shoto.
 */
const UNDISPUTED = ['Nansei-shoto'];
/** Kinds of area that aren't territorial disputes: leased bases and buffer zones. */
const NOT_DISPUTES = ['Lease', 'Overlay'];
/** Lakes smaller than this, in square map units (about 550 km²), are left out; Lake Biwa stays. */
const MIN_LAKE_AREA = 0.35;
/** Landmasses whose centre is within this many degrees of the largest one's count as the mainland… */
const MAINLAND_DEGREES = 12;
/** …if they are at least this share of its area, so small outlying islands don't widen the frame. */
const MAINLAND_SHARE = 0.02;
/**
 * How far, in map units, a simplified coastline may stray from the original:
 * about a third of a point at the closest zoom on Japan.
 */
const TOLERANCE = 0.08;
/** Islands smaller than this, in square map units, are left out. */
const MIN_AREA = 0.03;

type Point = [number, number];
type Ring = Point[];
type Polygon = Ring[];
interface Feature {
  properties: {
    ISO_A2_EH: string;
    NAME: string;
    NAME_LONG: string;
    ADMIN: string;
    SOVEREIGNT: string;
    [key: string]: unknown;
  };
  geometry: { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };
}

/**
 * Works out a ring's area and centre on a plain longitude–latitude grid,
 * with longitudes shrunk by the cosine of the latitude, so areas compare
 * roughly as on the globe.
 * @returns The area in square degrees and the centre in degrees.
 */
const measure = (ring: Ring): { area: number; centre: Point } => {
  const lat = ring.reduce((sum, [, y]) => sum + y, 0) / ring.length;
  const k = Math.cos((lat * Math.PI) / 180);
  const lon = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
  return { area: Math.abs(shoelace(ring.map(([x, y]) => [x * k, y]))), centre: [lon, lat] };
};

/**
 * Works out a ring's area by the shoelace formula.
 * @returns The signed area, in the ring's units squared.
 */
const shoelace = (ring: Ring): number => {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
};

/**
 * Simplifies a line by the Ramer–Douglas–Peucker algorithm, keeping its ends.
 * @returns The points kept, every one within `TOLERANCE` of the original line.
 */
const simplify = (points: Point[]): Point[] => {
  if (points.length < 3) {
    return points;
  }
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const length = Math.hypot(bx - ax, by - ay);
  let farthest = 0;
  let distance = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d =
      length === 0
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
    if (d > distance) {
      distance = d;
      farthest = i;
    }
  }
  if (distance <= TOLERANCE) {
    return [points[0], points[points.length - 1]];
  }
  return [...simplify(points.slice(0, farthest + 1)).slice(0, -1), ...simplify(points.slice(farthest))];
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Projects, simplifies, and rounds a ring, splitting it at its farthest
 * point so both halves keep their ends.
 * @returns The ring's points in map units, or null for an island too small to show.
 */
const toMapRing = (ring: Ring, minArea = MIN_AREA): Ring | null => {
  const points = ring.slice(0, -1).map(([lon, lat]) => toMap(lon, lat));
  if (Math.abs(shoelace(points)) < minArea) {
    return null;
  }
  const half = Math.floor(points.length / 2);
  const simplified = [
    ...simplify(points.slice(0, half + 1)).slice(0, -1),
    ...simplify([...points.slice(half), points[0]]).slice(0, -1),
  ].map(([x, y]): Point => [round(x), round(y)]);
  return simplified.filter((p, i) => i === 0 || p[0] !== simplified[i - 1][0] || p[1] !== simplified[i - 1][1]);
};

/**
 * Writes a number of tenths as short as SVG allows, e.g. `".5"` or `"-.5"`.
 * @returns The number in units, without a leading zero.
 */
const short = (tenths: number): string => String(tenths / 10).replace(/^(-?)0\./, '$1.');

/**
 * Writes a ring as SVG path data: an absolute move to its first point, then
 * one relative line through the rest, which is much shorter than absolute
 * points. Points are in tenths, so the steps add up exactly. Skia parses
 * the short forms, e.g. `"-.2.1"` for the step -0.2, 0.1.
 * @returns e.g. `"M838.6 106.1l.3-.2-1 .5z"`.
 */
const ringPath = (ring: Ring): string => {
  const tenths = ring.map(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]);
  const [first, ...rest] = tenths;
  let path = `M${short(first[0])} ${short(first[1])}l`;
  let last = '';
  rest.forEach(([x, y], i) => {
    const [px, py] = tenths[i];
    for (const step of [short(x - px), short(y - py)]) {
      // A separator is needed only where the next number could join the last one.
      const joins = last !== '' && !step.startsWith('-') && !(step.startsWith('.') && last.includes('.'));
      path += (joins ? ' ' : '') + step;
      last = step;
    }
  });
  return path + 'z';
};

/**
 * Downloads a GeoJSON file of Natural Earth's.
 * @returns Its features.
 */
const download = async <T>(url: string): Promise<T[]> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Couldn't download ${url}: ${response.status}`);
  }
  return ((await response.json()) as { features: T[] }).features;
};

const features = await download<Feature>(SOURCE);

const shapes = features
  .filter((f) => f.properties.ISO_A2_EH !== 'AQ')
  .map((f) => {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const path = polygons
      .flatMap((polygon) => polygon.map(toMapRing))
      .filter((ring): ring is Ring => ring !== null && ring.length >= 3)
      .map(ringPath)
      .join('');

    const measured = polygons.map((polygon) => ({ polygon, ...measure(polygon[0]) }));
    const largest = measured.reduce((a, b) => (b.area > a.area ? b : a));
    const k = Math.cos((largest.centre[1] * Math.PI) / 180);
    const mainland = measured.filter(
      ({ area, centre }) =>
        area >= largest.area * MAINLAND_SHARE &&
        Math.hypot((centre[0] - largest.centre[0]) * k, centre[1] - largest.centre[1]) <=
          MAINLAND_DEGREES,
    );
    const points = mainland.flatMap(({ polygon }) => polygon[0].map(([lon, lat]) => toMap(lon, lat)));
    const focus = [
      Math.min(...points.map(([x]) => x)),
      Math.min(...points.map(([, y]) => y)),
      Math.max(...points.map(([x]) => x)),
      Math.max(...points.map(([, y]) => y)),
    ].map(round);

    const code = f.properties.ISO_A2_EH;
    return { code: /^[A-Z]{2}$/.test(code) ? code : null, path, focus };
  })
  .filter((shape) => shape.path);

/**
 * Finds the disputed areas a region's country is party to, as administrator
 * or claimant (BR-SET-06): areas Natural Earth marks as disputed, with a
 * claim in its note ("Admin. by Russia; Claimed by Japan") or a country
 * whose point of view assigns the area elsewhere (e.g. Morocco's on Ceuta).
 * @returns The areas' projected rings, each area's box, and its name.
 */
const disputedAreas = async () => {
  const seed = new Set(seedRegions().flatMap((region) => region.countries));
  // Every name Natural Earth uses for a region's country, e.g. "United States of America".
  const names = features
    .filter((f) => seed.has(f.properties.ISO_A2_EH))
    .flatMap(({ properties: p }) => [p.NAME, p.NAME_LONG, p.ADMIN, p.SOVEREIGNT])
    .concat(['U.S.A.', 'United States']);
  const party = new RegExp(`\\b(${[...new Set(names)].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`);

  return (await download<Feature>(DISPUTED))
    .filter(({ properties: p }) => {
      if (NOT_DISPUTES.includes(String(p.TYPE)) || UNDISPUTED.includes(p.NAME) || /buffer|no man/i.test(p.NAME + p.ADMIN)) {
        return false;
      }
      const viewed = Object.entries(p)
        .filter(([key, value]) => /^ADM0_A3_[A-Z]{2}$/.test(key) && typeof value === 'string' && value !== 'UUU')
        .some(([, value]) => value !== p.ADM0_A3);
      const disputed = ['Disputed', 'Breakaway', 'Indeterminate'].includes(String(p.TYPE)) || /Claimed by/.test(String(p.NOTE_BRK)) || viewed;
      return disputed && party.test([p.SOVEREIGNT, p.ADMIN, p.NOTE_BRK].join(' '));
    })
    .map((f) => {
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const rings = polygons.map((polygon) => polygon[0].map(([lon, lat]) => toMap(lon, lat)));
      const points = rings.flat();
      return {
        name: f.properties.NAME,
        path: polygons
          .map((polygon) => toMapRing(polygon[0], 0))
          .filter((ring): ring is Ring => ring !== null && ring.length >= 3)
          .map(ringPath)
          .join(''),
        box: [
          Math.min(...points.map(([x]) => x)),
          Math.min(...points.map(([, y]) => y)),
          Math.max(...points.map(([x]) => x)),
          Math.max(...points.map(([, y]) => y)),
        ].map(round),
      };
    });
};

const disputed = await disputedAreas();
console.log(`Disputed areas: ${disputed.map((area) => area.name).join(', ')}`);

// Large lakes, drawn in the sea's colour over the land, which covers them.
const lakes = (await download<Pick<Feature, 'geometry'>>(LAKES))
  .flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates))
  .map((polygon) => toMapRing(polygon[0], MIN_LAKE_AREA))
  .filter((ring): ring is Ring => ring !== null && ring.length >= 3)
  .map(ringPath)
  .join('');

const out = new URL('../src/domain/world-map.json', import.meta.url);
writeFileSync(
  out,
  JSON.stringify({
    width: WIDTH,
    height: HEIGHT,
    lakes,
    disputed: disputed.map(({ path, box }) => ({ path, box })),
    shapes,
  }) + '\n',
);
console.log(`Wrote ${shapes.length} shapes, ${WIDTH}×${HEIGHT}, to ${out.pathname}`);
