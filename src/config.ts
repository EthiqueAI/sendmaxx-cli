import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "fs";

type Config = {
  token?: string;
  baseUrl?: string;
};

const CONFIG_DIR = join(homedir(), ".sendmaxx");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function readConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Config;
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<Config>): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const current = readConfig();
  const merged = { ...current, ...patch };
  // Remove undefined keys
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete (merged as Record<string, unknown>)[k];
  }
  // The file holds the API token: owner-only. `mode` only applies when the
  // file is created, so chmod too in case an older 0644 file already exists.
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}

// Global overrides — set by index.ts after parsing root opts
let _tokenOverride: string | undefined;
let _urlOverride: string | undefined;

export function setOverrides(token?: string, url?: string): void {
  _tokenOverride = token;
  _urlOverride = url;
}

export function getToken(): string {
  const token = _tokenOverride || readConfig().token;
  if (!token) {
    console.error("Not authenticated. Run `sendmaxx auth login` in a terminal.");
    process.exit(1);
  }
  return token;
}

export function getBaseUrl(): string {
  return _urlOverride || readConfig().baseUrl || "http://localhost:3000";
}
