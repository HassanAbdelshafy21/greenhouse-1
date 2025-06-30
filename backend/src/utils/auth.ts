import "dotenv/config";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import * as schema from "../drizzle/schema";
import { db } from "../drizzle";


console.log('Initializing better-auth...');

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.userTable,
      session: schema.sessionTable,
      account: schema.accountTable,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    requireEmailVerification: false,
    passwordHash: {
      type: 'scrypt', // Default in better-auth@1.2.8
    },
  },
  secret: process.env.BETTER_AUTH_SECRET || "qweqweqweasdwqedsa",
  baseURL: 'http://localhost:5000', // Explicitly set for session handling
  trustedOrigins: ['http://localhost:3000'],
  logger: {
    level: 'debug', // Enable debug logging for Better Auth
  }, 
  plugins: [nextCookies()] // make sure this is the last plugin in the array

});

console.log('Better-auth initialized successfully');