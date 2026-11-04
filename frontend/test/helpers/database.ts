// A stand-in for src/db/client.ts: the same functions on in-memory sql.js
// databases, migrated from the same drizzle/ files, since expo-sqlite is
// native. test/setup.ts loads it for every test. Each account keeps its
// database until the test ends, so a test can close and reopen it as an app
// restart would.
import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

import type { Database } from '@/db/client';
import * as schema from '@/db/schema';

let sqlJs: Promise<SqlJsStatic> | null = null;
const databases = new Map<string, Database>();
let current: string | null = null;

/**
 * Opens the account's in-memory database, creating and migrating it on first use.
 * @returns The database.
 */
export const openUserDatabase = async (userId: string): Promise<Database> => {
  let db = databases.get(userId);
  if (!db) {
    sqlJs ??= initSqlJs();
    db = drizzle(new (await sqlJs).Database(), { schema });
    migrate(db, { migrationsFolder: 'drizzle' });
    databases.set(userId, db);
  }
  current = userId;
  return db;
};

/**
 * Gets the open account database.
 * @returns The database.
 * @throws If none is open.
 */
export const database = (): Database => {
  const db = current && databases.get(current);
  if (!db) {
    throw new Error('No account database is open');
  }
  return db;
};

/** Closes the open database, keeping its data. */
export const closeUserDatabase = (): void => {
  current = null;
};

/** Deletes the account's database. */
export const deleteUserDatabase = (userId: string): void => {
  if (current === userId) {
    current = null;
  }
  databases.delete(userId);
};

/** Deletes every database, before each test. */
export const resetDatabases = (): void => {
  databases.clear();
  current = null;
};

/**
 * Tells whether the account still has a database on the "device".
 * @returns True until `deleteUserDatabase` removes it.
 */
export const hasDatabase = (userId: string): boolean => databases.has(userId);
