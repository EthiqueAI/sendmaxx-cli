/**
 * Pagination helpers shared by CLI list/search commands.
 *
 * Convention (matches `turbosend/lib/api/pagination.ts`):
 * - Caller passes `--limit` to opt into pagination. The server returns
 *   `{ <key>: items, total, limit, offset, hasMore }` (or, for endpoints that
 *   historically returned a bare array, `{ <key>: items, total, ... }` in
 *   place of the array).
 * - Without `--limit`, server returns the legacy shape (array or
 *   `{ <key>: items }` with no pagination meta). CLI falls back to that.
 */

import type { Command } from "commander";

export type PaginationMeta = {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type PaginationOpts = {
  limit?: string;
  offset?: string;
};

/** Add `--limit` and `--offset` to a (sub)command. */
export function addPaginationOptions(cmd: Command): Command {
  return cmd
    .option("--limit <n>", "Page size (opts into pagination; default 50 server-side, max 500)")
    .option("--offset <n>", "Number of results to skip (requires --limit)", "0");
}

/** Convert CLI opts into URL query params for the API client. */
export function paginationParams(opts: PaginationOpts): Record<string, string> {
  if (!opts.limit) return {};
  const params: Record<string, string> = { limit: String(opts.limit) };
  if (opts.offset && opts.offset !== "0") params.offset = String(opts.offset);
  return params;
}

/**
 * Extract `items` + `meta` from a response that may be:
 *   - a bare array (legacy)
 *   - `{ <key>: items }` with no meta (legacy envelope)
 *   - `{ <key>: items, total, limit, offset, hasMore }` (paginated)
 */
export function extractPaginated<T>(
  data: unknown,
  key: string,
): { items: T[]; meta: PaginationMeta | null } {
  if (Array.isArray(data)) return { items: data as T[], meta: null };
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const items = Array.isArray(obj[key]) ? (obj[key] as T[]) : [];
    const total = typeof obj.total === "number" ? obj.total : null;
    if (total !== null) {
      return {
        items,
        meta: {
          total,
          limit: Number(obj.limit),
          offset: Number(obj.offset),
          hasMore: Boolean(obj.hasMore),
        },
      };
    }
    return { items, meta: null };
  }
  return { items: [], meta: null };
}

/** Human-readable pagination footer for pretty (table) output. */
export function paginationFooter(meta: PaginationMeta | null): string | null {
  if (!meta) return null;
  const start = meta.offset + 1;
  const end = meta.offset + Math.min(meta.limit, meta.total - meta.offset);
  const more = meta.hasMore ? ` · more available (offset ${meta.offset + meta.limit})` : "";
  return `Showing ${start}–${end} of ${meta.total}${more}`;
}
