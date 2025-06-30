import "dotenv/config";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

import * as schema from "./schema";

const sqlite = new Database(process.env.DB_FILE_NAME); // This will create the file if it doesn't exist

export const db = drizzle(sqlite, { schema , logger: true });