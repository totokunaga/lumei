/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const backend = new URL('../../backend/migration/', import.meta.url).pathname;

/**
 * Reads every region and its countries from the backend's seed data
 * (backend/migration/*_seed_category_sets.up.sql), so the map's data follows
 * the regions the app offers.
 * @returns e.g. `[{ region: 'jp', countries: ['JP'] }, …]`, without regions that have no countries.
 */
export const seedRegions = (): { region: string; countries: string[] }[] => {
  const file = readdirSync(backend).find((name) => name.endsWith('_seed_category_sets.up.sql'));
  if (!file) {
    throw new Error(`No category set seed migration in ${backend}`);
  }
  const sql = readFileSync(join(backend, file), 'utf8');
  return [...sql.matchAll(/\('([a-z]+)', \d+,[^)]*?'\{([A-Z,]+)\}'\)/g)].map(([, region, codes]) => ({
    region,
    countries: codes.split(','),
  }));
};
