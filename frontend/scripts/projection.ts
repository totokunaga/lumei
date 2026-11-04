// The projection of Lumei's world map (see world-map.ts and relief.ts): the
// Natural Earth projection (Šavrič et al., 2015), as d3's geoNaturalEarth1,
// scaled to 1000 units across, with y downwards and Antarctica cut off.

/** The map's width in its own units. */
export const WIDTH = 1000;

/** The southernmost latitude shown: everything south of it (Antarctica) is cut off. */
const SOUTH = -56;
/** The northernmost latitude shown. */
const NORTH = 84;

/**
 * Projects a longitude and latitude in degrees.
 * @returns x to the east and y to the north, in radians of the unit sphere.
 */
const project = (lon: number, lat: number): [number, number] => {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const p2 = p * p;
  const p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
};

const [MAX_X] = project(180, 0);
const [, MAX_Y] = project(0, NORTH);
const [, MIN_Y] = project(0, SOUTH);
const SCALE = WIDTH / (2 * MAX_X);

/** The map's height in its own units. */
export const HEIGHT = Math.ceil((MAX_Y - MIN_Y) * SCALE);

/**
 * Converts a longitude and latitude in degrees to the map's units.
 * @returns x and y, e.g. about [500, 250] for 0°, 0°.
 */
export const toMap = (lon: number, lat: number): [number, number] => {
  const [x, y] = project(lon, lat);
  return [(x + MAX_X) * SCALE, (MAX_Y - y) * SCALE];
};

/**
 * Converts a point in the map's units back to a longitude and latitude, by
 * Newton's method on the latitude, as d3 does.
 * @returns Degrees, or null for a point outside the map's outline.
 */
export const fromMap = (mx: number, my: number): [number, number] | null => {
  const x = mx / SCALE - MAX_X;
  const y = MAX_Y - my / SCALE;
  let p = y;
  for (let i = 0; i < 25; i++) {
    const p2 = p * p;
    const p4 = p2 * p2;
    const delta =
      (p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - y) /
      (1.007226 + p2 * (0.015085 * 3 + p4 * (-0.044475 * 7 + 0.028874 * 9 * p2 - 0.005916 * 11 * p4)));
    p -= delta;
    if (Math.abs(delta) < 1e-9) {
      break;
    }
  }
  const p2 = p * p;
  const l = x / (0.8707 + p2 * (-0.131979 + p2 * (-0.013791 + p2 * p2 * p2 * (0.003971 - 0.001529 * p2))));
  const lon = (l * 180) / Math.PI;
  const lat = (p * 180) / Math.PI;
  return Math.abs(lon) > 180 || Math.abs(lat) > 90 ? null : [lon, lat];
};
