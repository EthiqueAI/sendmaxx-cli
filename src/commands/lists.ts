import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { api } from "../client.js";
import { print, fail, ok, type Format } from "../output.js";
import {
  addPaginationOptions,
  extractPaginated,
  paginationFooter,
  paginationParams,
  type PaginationOpts,
} from "../pagination.js";

export function registerLists(program: Command): void {
  const lists = program.command("lists").description("Manage contact lists");

  const listCmd = lists.command("list").description("List all contact lists");
  listCmd
    .option("--include-archived", "Include archived lists (default: active only)")
    .option("--archived-only", "Only return archived lists");
  addPaginationOptions(listCmd);
  listCmd.action(async (opts: PaginationOpts & { includeArchived?: boolean; archivedOnly?: boolean }) => {
    const fmt: Format = program.opts().pretty ? "pretty" : "json";
    const params = paginationParams(opts);
    if (opts.includeArchived) params.include_archived = "1";
    if (opts.archivedOnly) params.archived_only = "1";
    const result = await api<unknown>("GET", "/api/lists", undefined, params);
    if (result.error) return fail(result.error.error);
    const { items, meta } = extractPaginated<Record<string, unknown>>(result.data, "lists");
    if (fmt === "json") {
      print(result.data, fmt);
    } else {
      print(items, fmt, {
        head: ["ID", "Name", "Type", "Members", "Source"],
        rows: (l: Record<string, unknown>) => [
          String(l.id ?? "").slice(0, 8),
          String(l.name ?? ""),
          String(l.type ?? "manual"),
          String(l.memberCount ?? 0),
          String(l.source ?? "—"),
        ],
      });
      const footer = paginationFooter(meta);
      if (footer) console.error(footer);
    }
  });

  lists
    .command("get <id>")
    .description("Get list details with contacts")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("GET", `/api/lists/${id}`);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  lists
    .command("create")
    .description("Create a contact list (manual | smart | tagged | icp)")
    .requiredOption("--name <name>", "List name")
    .option("--description <desc>", "List description")
    .option("--type <type>", "manual | smart | tagged | icp", "manual")
    .option("--query <json>", "Filter query as JSON (for smart lists)")
    .option("--query-file <path>", "Path to JSON file with the query (for smart lists)")
    .option("--tag <tag>", "Tag this list pulls (for tagged lists)")
    .option("--icp-slug <slug>", "ICP slug this list is derived from (for icp lists)")
    .option("--source <source>", "Override source label (default: claude when token-auth)")
    .action(
      async (opts: {
        name: string;
        description?: string;
        type: string;
        query?: string;
        queryFile?: string;
        tag?: string;
        icpSlug?: string;
        source?: string;
      }) => {
        const fmt: Format = program.opts().pretty ? "pretty" : "json";

        const body: Record<string, unknown> = {
          name: opts.name,
          description: opts.description,
          type: opts.type,
          tag: opts.tag,
          icpSlug: opts.icpSlug,
          source: opts.source,
        };

        if (opts.type === "smart") {
          let queryStr = opts.query;
          if (opts.queryFile) {
            queryStr = readFileSync(opts.queryFile, "utf-8");
          }
          if (!queryStr) {
            return fail("Smart list requires --query or --query-file");
          }
          // Validate JSON before sending
          try {
            JSON.parse(queryStr);
          } catch {
            return fail("--query is not valid JSON");
          }
          body.query = queryStr;
        }

        const result = await api<unknown>("POST", "/api/lists", body);
        if (result.error) return fail(result.error.error);
        print(result.data, fmt);
      },
    );

  lists
    .command("update <id>")
    .description("Update a list's name, description, query (smart), or tag (tagged)")
    .option("--name <name>", "New name")
    .option("--description <desc>", "New description")
    .option("--query <json>", "New query (smart lists only)")
    .option("--query-file <path>", "Path to JSON file with the query (smart lists only)")
    .option("--tag <tag>", "New tag (tagged lists only)")
    .action(
      async (
        id: string,
        opts: { name?: string; description?: string; query?: string; queryFile?: string; tag?: string },
      ) => {
        const fmt: Format = program.opts().pretty ? "pretty" : "json";
        const body: Record<string, unknown> = {};
        if (opts.name !== undefined) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.tag !== undefined) body.tag = opts.tag;
        if (opts.queryFile) {
          body.query = readFileSync(opts.queryFile, "utf-8");
        } else if (opts.query !== undefined) {
          body.query = opts.query;
        }
        if (Object.keys(body).length === 0) return fail("No fields to update");
        const result = await api<unknown>("PATCH", `/api/lists/${id}`, body);
        if (result.error) return fail(result.error.error);
        print(result.data, fmt);
      },
    );

  lists
    .command("archive <id>")
    .description("Archive a list. Hidden from default views; restorable. Campaigns that snapshotted from it are unaffected.")
    .action(async (id: string) => {
      const result = await api<{ ok: boolean; archivedAt?: number; alreadyArchived?: boolean }>(
        "POST",
        `/api/lists/${id}/archive`,
      );
      if (result.error) return fail(result.error.error);
      ok(result.data.alreadyArchived ? `Already archived: ${id}` : `Archived ${id}`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  lists
    .command("restore <id>")
    .description("Restore an archived list.")
    .action(async (id: string) => {
      const result = await api<{ ok: boolean; alreadyActive?: boolean }>("POST", `/api/lists/${id}/restore`);
      if (result.error) return fail(result.error.error);
      ok(result.data.alreadyActive ? `Already active: ${id}` : `Restored ${id}`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  lists
    .command("delete <id>")
    .description("Hard-delete a list. Cannot be undone. Prefer `lists archive` for soft removal. (Claude tokens may only delete Claude-made lists.)")
    .requiredOption("--yes", "Confirm deletion")
    .action(async (id: string) => {
      const result = await api<unknown>("DELETE", `/api/lists/${id}`);
      if (result.error) return fail(result.error.error);
      ok(`Deleted list ${id}`);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });

  lists
    .command("convert-to-manual <id>")
    .description("Materialize current members of a smart/tagged/icp list and freeze it")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("POST", `/api/lists/${id}/convert-to-manual`);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  lists
    .command("add <listId>")
    .description("Add contacts to a manual list")
    .requiredOption("--contacts <ids>", "Comma-separated contact IDs")
    .action(async (listId: string, opts: { contacts: string }) => {
      const contactIds = opts.contacts.split(",").map((s) => s.trim());
      const result = await api<unknown>("POST", `/api/lists/${listId}/members`, { contactIds });
      if (result.error) return fail(result.error.error);
      ok(`Added ${contactIds.length} contact(s) to list`);
      process.stdout.write(JSON.stringify({ ok: true, added: contactIds.length }) + "\n");
    });

  lists
    .command("remove <listId>")
    .description("Remove contacts from a manual list")
    .requiredOption("--contacts <ids>", "Comma-separated contact IDs")
    .action(async (listId: string, opts: { contacts: string }) => {
      const contactIds = opts.contacts.split(",").map((s) => s.trim());
      const result = await api<unknown>("DELETE", `/api/lists/${listId}/members`, { contactIds });
      if (result.error) return fail(result.error.error);
      ok(`Removed ${contactIds.length} contact(s) from list`);
      process.stdout.write(JSON.stringify({ ok: true, removed: contactIds.length }) + "\n");
    });
}
