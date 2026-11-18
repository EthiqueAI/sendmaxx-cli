/**
 * Keeps a local markdown mirror of every active ICP in sync with the server.
 *
 * Layout: ~/.sendmaxx/icps/<slug>.md holds the ICP's `content` field verbatim
 * (pure markdown, safe to pass back via --content-file). Sync bookkeeping lives
 * in ~/.sendmaxx/icps/.sync-state.json: for each slug, the hash of the content
 * both sides agreed on at the last sync.
 *
 * Reconciliation is a three-way compare against that base hash:
 *   - only the local file changed  → push it to the server
 *   - only the server changed      → pull it into the local file
 *   - both changed (or no base)    → conflict: nothing is overwritten; the
 *     server version is written next to it as <slug>.server.md
 * An ICP that is archived or deleted on the server — or that this user can no
 * longer see because the workspace switched to user mode — has its local file
 * removed; unpushed local edits are kept as <slug>.local-edits.md instead of
 * discarded.
 * Deleting a local file never deletes anything on the server — the next sync
 * pulls it back.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { api } from "./client.js";
import { CONFIG_DIR } from "./config.js";

export const ICPS_DIR = join(CONFIG_DIR, "icps");
const STATE_FILE = join(ICPS_DIR, ".sync-state.json");

// Server-generated slugs are [a-z0-9-]. Anything else isn't mirrored, which
// also keeps a hand-picked slug like "../x" from escaping ICPS_DIR.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;

export type ServerIcp = {
  slug: string;
  content?: string | null;
  status?: string | null;
  archivedAt?: number | null;
  [key: string]: unknown;
};

export type Prefer = "local" | "server";

/**
 * Why an ICP is no longer active for this user. "hidden" is a 403: it still
 * exists, but belongs to a teammate and the workspace is in user mode.
 */
export type GoneReason = "archived" | "deleted" | "hidden";

const GONE_NOTE: Record<GoneReason | "unknown", string> = {
  archived: "archived on the server",
  deleted: "deleted on the server",
  hidden: "no longer visible to you — the workspace switched to user mode and this ICP belongs to a teammate",
  unknown: "archived or deleted on the server",
};

export type SyncAction =
  | "pulled"
  | "pushed"
  | "unchanged"
  | "removed"
  | "conflict"
  | "local-only"
  | "skipped"
  | "error";

export type SyncResult = {
  slug: string;
  action: SyncAction;
  path?: string;
  note?: string;
  /** Latest server row, when this sync changed it (a push). */
  server?: ServerIcp;
};

type SyncState = { icps: Record<string, { hash: string }> };

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const isActive = (icp: ServerIcp) => !icp.archivedAt && icp.status !== "archived";

export const localPath = (slug: string) => join(ICPS_DIR, `${slug}.md`);
const serverCopyPath = (slug: string) => join(ICPS_DIR, `${slug}.server.md`);
const localEditsPath = (slug: string) => join(ICPS_DIR, `${slug}.local-edits.md`);

function atomicWrite(path: string, content: string): void {
  mkdirSync(ICPS_DIR, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function readLocal(slug: string): string | null {
  const path = localPath(slug);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function removeIfExists(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

export function loadState(): SyncState {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as SyncState;
    return parsed && typeof parsed.icps === "object" ? parsed : { icps: {} };
  } catch {
    return { icps: {} };
  }
}

export function saveState(state: SyncState): void {
  atomicWrite(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function pull(slug: string, content: string, state: SyncState, note?: string): SyncResult {
  atomicWrite(localPath(slug), content);
  removeIfExists(serverCopyPath(slug));
  state.icps[slug] = { hash: hash(content) };
  return { slug, action: "pulled", path: localPath(slug), note };
}

async function push(slug: string, content: string, state: SyncState, note?: string): Promise<SyncResult> {
  const result = await api<ServerIcp>("PATCH", `/api/icps/${slug}`, { content });
  if (result.error) {
    return { slug, action: "error", path: localPath(slug), note: `push failed: ${result.error.error}` };
  }
  removeIfExists(serverCopyPath(slug));
  state.icps[slug] = { hash: hash(content) };
  return { slug, action: "pushed", path: localPath(slug), note, server: result.data };
}

/**
 * Reconcile one ICP. `server` is the current server row, or null when the ICP
 * isn't available to this user. `gone` says why, when the caller knows; an
 * archived row is recognised on its own.
 */
export async function reconcileOne(
  slug: string,
  server: ServerIcp | null,
  state: SyncState,
  opts: { prefer?: Prefer; gone?: GoneReason } = {},
): Promise<SyncResult> {
  if (!SLUG_RE.test(slug)) {
    return { slug, action: "skipped", note: "slug isn't filename-safe, so it isn't mirrored locally" };
  }
  const base = state.icps[slug]?.hash ?? null;
  const local = readLocal(slug);
  const localHash = local === null ? null : hash(local);
  const active = server && isActive(server) ? server : null;

  if (!active) {
    const gone: GoneReason | undefined = server ? "archived" : opts.gone;
    const goneNote = GONE_NOTE[gone ?? "unknown"];
    if (local === null) {
      delete state.icps[slug];
      removeIfExists(serverCopyPath(slug));
      return { slug, action: "unchanged" };
    }
    if (base === null) {
      return {
        slug,
        action: "local-only",
        path: localPath(slug),
        note: gone === "hidden"
          ? `${GONE_NOTE.hidden}; the local file was left untouched`
          : `not an active ICP on the server. Create it with: sendmaxx icps create --slug ${slug} --name "<name>" --content-file ${localPath(slug)} (or restore it, if it was archived)`,
      };
    }
    delete state.icps[slug];
    removeIfExists(serverCopyPath(slug));
    if (localHash === base) {
      unlinkSync(localPath(slug));
      return { slug, action: "removed", note: goneNote };
    }
    renameSync(localPath(slug), localEditsPath(slug));
    return {
      slug,
      action: "removed",
      path: localEditsPath(slug),
      note: `${goneNote}; your unpushed local edits were kept at ${localEditsPath(slug)}`,
    };
  }

  const serverContent = active.content ?? "";
  const serverHash = hash(serverContent);

  if (local === null) return pull(slug, serverContent, state);
  if (localHash === serverHash) {
    state.icps[slug] = { hash: serverHash };
    removeIfExists(serverCopyPath(slug));
    return { slug, action: "unchanged", path: localPath(slug) };
  }

  const localChanged = base === null || localHash !== base;
  const serverChanged = base === null || serverHash !== base;
  if (!localChanged) return pull(slug, serverContent, state);
  if (!serverChanged) return push(slug, local, state);

  // Both sides changed since the last sync (or there's no record of one).
  if (opts.prefer === "server") {
    atomicWrite(localEditsPath(slug), local);
    return pull(slug, serverContent, state, `conflict resolved with the server version; your local edits were kept at ${localEditsPath(slug)}`);
  }
  if (opts.prefer === "local") {
    return push(slug, local, state, "conflict resolved with the local version");
  }
  atomicWrite(serverCopyPath(slug), serverContent);
  return {
    slug,
    action: "conflict",
    path: localPath(slug),
    note: `local file and server both changed; server version saved to ${serverCopyPath(slug)}. Resolve with: sendmaxx icps sync ${slug} --prefer local|server`,
  };
}

/**
 * The server just accepted `server.content` as the ICP body (create, or update
 * with new content). Make the local file match it. If the local file held
 * edits that were never pushed and differ from the new content, keep them
 * aside rather than silently overwriting.
 */
export function adoptServerContent(server: ServerIcp, state: SyncState): SyncResult {
  const slug = server.slug;
  if (!SLUG_RE.test(slug)) {
    return { slug, action: "skipped", note: "slug isn't filename-safe, so it isn't mirrored locally" };
  }
  const content = server.content ?? "";
  const local = readLocal(slug);
  const base = state.icps[slug]?.hash ?? null;
  if (local !== null && hash(local) !== hash(content) && hash(local) !== base) {
    atomicWrite(localEditsPath(slug), local);
    return pull(slug, content, state, `the local file had different unpushed edits; they were kept at ${localEditsPath(slug)}`);
  }
  return pull(slug, content, state);
}

/**
 * Ask the server about one ICP the list didn't return: archived, deleted, or
 * hidden from this user by user mode. Returns the row when it is in fact
 * active (the list raced a restore), so it is reconciled rather than removed.
 */
export async function probeIcp(
  slug: string,
): Promise<{ row: ServerIcp | null; gone?: GoneReason; rateLimited?: boolean }> {
  const result = await api<ServerIcp>("GET", `/api/icps/${slug}`);
  if (!result.error) return { row: result.data };
  switch (result.error.status) {
    case 403:
      return { row: null, gone: "hidden" };
    case 404:
      return { row: null, gone: "deleted" };
    case 429:
      return { row: null, rateLimited: true };
    default:
      return { row: null };
  }
}

/**
 * Reconcile every ICP in `rows`. With `complete: true` the rows are the full
 * set of ICPs this user can see, so local files for anything missing from them
 * are removed — after one lookup each, to say why (archived, deleted, or hidden
 * by user mode). Lookups stop at the first rate limit; the rest get the
 * generic note.
 */
export async function reconcileAll(
  rows: ServerIcp[],
  state: SyncState,
  opts: { prefer?: Prefer; complete: boolean },
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    seen.add(row.slug);
    results.push(await reconcileOne(row.slug, row, state, opts));
  }
  if (opts.complete) {
    const localSlugs = existsSync(ICPS_DIR)
      ? readdirSync(ICPS_DIR)
          .filter((f) => f.endsWith(".md"))
          .map((f) => f.slice(0, -3))
          .filter((s) => SLUG_RE.test(s))
      : [];
    const missing = new Set([...localSlugs, ...Object.keys(state.icps)].filter((s) => !seen.has(s)));
    let probing = true;
    for (const slug of missing) {
      let row: ServerIcp | null = null;
      let gone: GoneReason | undefined;
      if (probing && SLUG_RE.test(slug)) {
        const probe = await probeIcp(slug);
        if (probe.rateLimited) probing = false;
        row = probe.row;
        gone = probe.gone;
      }
      results.push(await reconcileOne(slug, row, state, { ...opts, gone }));
    }
  }
  return results;
}

/** One-line stderr notices for the results worth surfacing during auto-sync. */
export function reportResults(results: SyncResult[], opts: { includePulls?: boolean } = {}): void {
  for (const r of results) {
    const where = r.path ? ` (${r.path})` : "";
    const why = r.note ? ` — ${r.note}` : "";
    switch (r.action) {
      case "pushed":
        console.error(`↑ Pushed local edits to ICP ${r.slug}${where}${why}`);
        break;
      case "pulled":
        if (opts.includePulls || r.note) console.error(`✓ Local copy of ICP ${r.slug}: ${r.path}${why}`);
        break;
      case "removed":
        console.error(`✓ Removed local copy of ICP ${r.slug}${why}`);
        break;
      case "conflict":
      case "local-only":
      case "error":
        console.error(`! ICP ${r.slug}${where}${why}`);
        break;
    }
  }
}

/**
 * Run a sync step after a successful server operation. Local-mirror failures
 * (read-only home dir, sandbox, etc.) warn but never fail the command.
 */
export async function autoSync<T>(fn: (state: SyncState) => Promise<T> | T): Promise<T | undefined> {
  try {
    const state = loadState();
    const out = await fn(state);
    saveState(state);
    return out;
  } catch (err) {
    console.error(`! Couldn't sync the local ICP copy in ${ICPS_DIR}: ${(err as Error).message}`);
    return undefined;
  }
}
