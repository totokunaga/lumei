// Opens the signed-in account's database file. Each account has its own file,
// so a second account on the device never sees the first one's data, and
// signing out can delete it (BR-ACC-04).
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import migrations from '../../drizzle/migrations';
import { databaseFileName as fileName } from './file-name';
import * as schema from './schema';

/**
 * A database with the app's schema. Queries run synchronously, as with
 * `expo-sqlite`'s sync API, which keeps saves fast enough for BR-NFR-04. Tests
 * use the same type on an in-memory database.
 */
export type Database = BaseSQLiteDatabase<'sync', any, typeof schema>;

let current: { userId: string; file: SQLiteDatabase; db: Database } | null = null;

/**
 * Opens the account's database, creating it on first use, and migrates it to
 * the app's schema. Opening the account that is already open does nothing.
 * @returns The open database.
 * @throws If the file can't be opened or a migration fails.
 */
export const openUserDatabase = async (userId: string): Promise<Database> => {
  if (current?.userId === userId) {
    return current.db;
  }
  closeUserDatabase();
  const file = openDatabaseSync(fileName(userId), { enableChangeListener: true });
  const db = drizzle(file, { schema });
  await migrate(db, migrations);
  current = { userId, file, db };
  return db;
};

/**
 * Gets the open account database.
 * @returns The database `openUserDatabase` opened.
 * @throws If no account database is open, i.e. no one is signed in.
 */
export const database = (): Database => {
  if (!current) {
    throw new Error('No account database is open');
  }
  return current.db;
};

/** Closes the open account database, if any, keeping its file. */
export const closeUserDatabase = (): void => {
  current?.file.closeSync();
  current = null;
};

/** Closes the account's database if it is open, and deletes its file (BR-ACC-04). */
export const deleteUserDatabase = (userId: string): void => {
  if (current?.userId === userId) {
    closeUserDatabase();
  }
  deleteDatabaseSync(fileName(userId));
};
