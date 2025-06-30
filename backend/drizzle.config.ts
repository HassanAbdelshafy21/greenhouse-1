import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/drizzle/schema.ts',
  out: './src/drizzle/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_FILE_NAME! as string
  },
  verbose: true,
  strict: true
});