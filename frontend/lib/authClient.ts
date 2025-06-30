"use client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "http://localhost:5000", // Your Express backend
  fetchOptions: {
    credentials: "include", // Ensure cookies are sent with requests
  },
});

// Export hooks for easy use in components
export const { useSession, signIn, signOut } = authClient;