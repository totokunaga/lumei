// drizzle-kit config: `bun run db:generate` writes SQL migrations for
// src/db/schema.ts to drizzle/, bundled into the app by drizzle/migrations.js.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
});
