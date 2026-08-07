import { existsSync } from "node:fs";
import { config } from "dotenv";

/**
 * Loads .env.local then .env for local runs.
 *
 * dotenv does not overwrite variables that are already set, so in GitHub
 * Actions — where the values arrive as repository secrets and no .env file
 * exists — this is a no-op.
 */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) config({ path: file, quiet: true });
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
