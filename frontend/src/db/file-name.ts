/**
 * Names the database file of an account. Each account has its own file
 * (BR-ACC-04), which the "Add Expense" shortcut finds by this name too
 * (BR-EXP-12).
 * @returns e.g. `"lumei-0199a6c5-….db"`.
 */
export const databaseFileName = (userId: string): string => `lumei-${userId}.db`;
