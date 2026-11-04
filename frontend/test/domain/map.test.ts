import {
  cameraFor,
  countriesPath,
  disputedDots,
  disputedPath,
  landPath,
  regionBox,
  visibleBox,
  WORLD,
  WORLD_BOX,
} from '@/domain/map';

import { toMap } from '../../scripts/projection';

/** The EU's member states, as the seed data lists them. */
const EU = 'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' ');

describe('regionBox (BR-SET-06)', () => {
  it.each([
    // France's mainland ends east of the Atlantic (x ≈ 489), so French Guiana
    // (x ≈ 340) and Réunion (x ≈ 640) are left out.
    { name: 'France on its mainland', codes: ['FR'], within: { x0: 480, y0: 80, x1: 530, y1: 125 } },
    // The lower 48 states, without Alaska (x < 150) and Hawaii.
    {
      name: 'the US without Alaska and Hawaii',
      codes: ['US'],
      within: { x0: 175, y0: 85, x1: 340, y1: 180 },
    },
    // All of the EU's mainlands, from Portugal to Cyprus and up to Finland.
    { name: 'the EU on Europe', codes: EU, within: { x0: 470, y0: 30, x1: 595, y1: 145 } },
  ])('frames $name', ({ codes, within }) => {
    const box = regionBox(codes);
    expect(box.x0).toBeGreaterThanOrEqual(within.x0);
    expect(box.y0).toBeGreaterThanOrEqual(within.y0);
    expect(box.x1).toBeLessThanOrEqual(within.x1);
    expect(box.y1).toBeLessThanOrEqual(within.y1);
  });

  it('keeps all of Japan’s main islands, Hokkaido to Kyushu', () => {
    const box = regionBox(['JP']);
    expect(box.y1 - box.y0).toBeGreaterThan(40);
  });

  it.each([
    { name: 'no countries, as for "Other"', codes: [] },
    { name: 'only unknown codes', codes: ['XX', 'ZZ'] },
  ])('frames the whole world for $name', ({ codes }) => {
    expect(regionBox(codes)).toBe(WORLD_BOX);
  });
});

describe('cameraFor', () => {
  const viewport = { width: 350, height: 220 };

  it('fits the whole map, centred, for the world', () => {
    expect(cameraFor(WORLD_BOX, viewport)).toEqual({
      scale: 0.35,
      x: 0,
      y: 110 - (WORLD.height / 2) * 0.35,
    });
  });

  it.each([
    {
      name: 'zooms until the box fills three quarters of the narrower side',
      box: { x0: 100, y0: 100, x1: 200, y1: 150 },
      scale: Math.min((350 * 0.75) / 100, (220 * 0.75) / 50),
    },
    {
      name: 'zooms no closer than 16 times the whole map',
      box: { x0: 500, y0: 100, x1: 501, y1: 101 },
      scale: 0.35 * 16,
    },
    {
      name: 'zooms out no further than the whole map',
      box: { x0: -2000, y0: -2000, x1: 3000, y1: 3000 },
      scale: 0.35,
    },
  ])('$name', ({ box, scale }) => {
    const camera = cameraFor(box, viewport);
    expect(camera.scale).toBeCloseTo(scale);
    // The box's centre lands on the viewport's.
    expect(((box.x0 + box.x1) / 2) * camera.scale + camera.x).toBeCloseTo(175);
    expect(((box.y0 + box.y1) / 2) * camera.scale + camera.y).toBeCloseTo(110);
  });
});

describe('countriesPath and landPath', () => {
  it('joins the paths of the countries asked for', () => {
    const japan = WORLD.shapes.find((shape) => shape.code === 'JP')!.path;
    const france = WORLD.shapes.find((shape) => shape.code === 'FR')!.path;
    expect(countriesPath(['FR', 'JP'])).toBe(france + japan);
    expect(countriesPath([])).toBe('');
  });

  it('has the large lakes, drawn over the land', () => {
    // At least the five Great Lakes, each its own ring.
    expect(WORLD.lakes.match(/M/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('draws every shape as land, including territories without a code', () => {
    expect(landPath()).toContain(WORLD.shapes.find((shape) => shape.code === null)!.path);
    expect(WORLD.shapes.some((shape) => shape.code === 'AQ')).toBe(false);
  });
});

describe('disputed areas (BR-SET-06)', () => {
  /** Checks whether any disputed area's box overlaps `box`. */
  const hasDisputedAreaIn = (box: { x0: number; y0: number; x1: number; y1: number }) =>
    WORLD.disputed.some(
      ({ box: [x0, y0, x1, y1] }) => x0 <= box.x1 && x1 >= box.x0 && y0 <= box.y1 && y1 >= box.y0,
    );

  /** A box of the map half a unit around a longitude and latitude. */
  const around = (lon: number, lat: number) => {
    const [x, y] = toMap(lon, lat);
    return { x0: x - 0.5, y0: y - 0.5, x1: x + 0.5, y1: y + 0.5 };
  };

  it.each([
    { name: 'the Northern Territories', at: around(146.5, 44), disputed: true },
    { name: 'Takeshima', at: around(131.87, 37.24), disputed: true },
    { name: 'Northern Cyprus', at: around(33.6, 35.3), disputed: true },
    { name: 'Gibraltar', at: around(-5.35, 36.14), disputed: true },
    // Japan holds there is no dispute over the Senkaku Islands.
    { name: 'not the Senkaku Islands', at: around(123.5, 25.75), disputed: false },
    // No region's country is party to it.
    { name: 'not Crimea', at: around(34.1, 45.3), disputed: false },
  ])('marks $name', ({ at, disputed }) => {
    expect(hasDisputedAreaIn(at)).toBe(disputed);
  });

  it('puts a dot on islands too small to outline, e.g. Takeshima', () => {
    const takeshima = around(131.87, 37.24);
    expect(
      disputedDots().some(
        ({ x, y }) => x >= takeshima.x0 && x <= takeshima.x1 && y >= takeshima.y0 && y <= takeshima.y1,
      ),
    ).toBe(true);
  });

  it('joins the outlines of the areas large enough to have one', () => {
    expect(disputedPath()).toBe(WORLD.disputed.map((area) => area.path).join(''));
    expect(disputedPath()).not.toBe('');
  });
});

describe('visibleBox', () => {
  it('works out the part of the map a camera shows', () => {
    expect(visibleBox({ scale: 2, x: -100, y: -50 }, { width: 400, height: 200 })).toEqual({
      x0: 50,
      y0: 25,
      x1: 250,
      y1: 125,
    });
  });
});
