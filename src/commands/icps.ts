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

function buildIcpCommands(program: Command, name: string): void {
  const icps = program.command(name).description("Manage ICPs (ideal customer profiles)");

  const listCmd = icps.command("list").description("List ICPs");
  listCmd
    .option("--include-archived", "Include archived ICPs (default: active only)")
    .option("--archived-only", "Only return archived ICPs");
  addPaginationOptions(listCmd);
  listCmd.action(async (opts: PaginationOpts & { includeArchived?: boolean; archivedOnly?: boolean }) => {
    const fmt: Format = program.opts().pretty ? "pretty" : "json";
    const params = paginationParams(opts);
    if (opts.includeArchived) params.include_archived = "1";
    if (opts.archivedOnly) params.archived_only = "1";
    const result = await api<unknown>("GET", "/api/icps", undefined, params);
    if (result.error) return fail(result.error.error);
    const { items, meta } = extractPaginated<Record<string, unknown>>(result.data, "icps");
    if (fmt === "json") {
      print(result.data, fmt);
    } else {
      print(items, fmt, {
        head: ["Slug", "Name", "Status", "Description"],
        rows: (i: Record<string, unknown>) => [
          String(i.slug ?? ""),
          String(i.name ?? ""),
          String(i.status ?? ""),
          String(i.description ?? "").slice(0, 60),
        ],
      });
      const footer = paginationFooter(meta);
      if (footer) console.error(footer);
    }
  });

  icps
    .command("get <slug>")
    .description("Get ICP details (including markdown content)")
    .action(async (slug: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("GET", `/api/icps/${slug}`);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  icps
    .command("create")
    .description("Create an ICP. Auto-spawns an ICP-derived list unless --no-list.")
    .requiredOption("--name <name>", "Display name")
    .option("--slug <slug>", "Slug (defaults to slugified name)")
    .option("--description <desc>", "Short description")
    .option("--content <markdown>", "ICP doc body as a string")
    .option("--content-file <path>", "Path to a markdown file with the ICP body")
    .option("--parent-icp-id <id>", "Parent ICP id (for sub-ICPs)")
    .option("--no-list", "Skip auto-spawning the ICP-derived list")
    .action(
      async (opts: {
        name: string;
        slug?: string;
        description?: string;
        content?: string;
        contentFile?: string;
        parentIcpId?: string;
        list?: boolean; // commander: --no-list flips this to false
      }) => {
        const fmt: Format = program.opts().pretty ? "pretty" : "json";
        let content = opts.content;
        if (opts.contentFile) content = readFileSync(opts.contentFile, "utf-8");
        const body: Record<string, unknown> = {
          name: opts.name,
          slug: opts.slug,
          description: opts.description,
          content,
          parentIcpId: opts.parentIcpId,
          autoSpawnList: opts.list !== false,
        };
        const result = await api<unknown>("POST", "/api/icps", body);
        if (result.error) return fail(result.error.error);
        print(result.data, fmt);
      },
    );

  icps
    .command("update <slug>")
    .description("Update an ICP")
    .option("--name <name>", "New name")
    .option("--description <desc>", "New description")
    .option("--content <markdown>", "New ICP doc body as a string")
    .option("--content-file <path>", "Path to a markdown file")
    .option("--status <status>", "active | archived")
    .option("--parent-icp-id <id>", "New parent ICP id (pass empty string to unparent)")
    .action(
      async (
        slug: string,
        opts: {
          name?: string;
          description?: string;
          content?: string;
          contentFile?: string;
          status?: string;
          parentIcpId?: string;
        },
      ) => {
        const fmt: Format = program.opts().pretty ? "pretty" : "json";
        const body: Record<string, unknown> = {};
        if (opts.name !== undefined) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.status !== undefined) body.status = opts.status;
        if (opts.parentIcpId !== undefined) body.parentIcpId = opts.parentIcpId || null;
        if (opts.contentFile) body.content = readFileSync(opts.contentFile, "utf-8");
        else if (opts.content !== undefined) body.content = opts.content;
        if (Object.keys(body).length === 0) return fail("No fields to update");
        const result = await api<unknown>("PATCH", `/api/icps/${slug}`, body);
        if (result.error) return fail(result.error.error);
        print(result.data, fmt);
      },
    );

  icps
    .command("archive <slug>")
    .description("Archive an ICP. By default also archives its auto-spawned list (cascade). Use --keep-list to leave the list active.")
    .option("--keep-list", "Don't cascade-archive the ICP's auto-spawned list")
    .action(async (slug: string, opts: { keepList?: boolean }) => {
      const result = await api<{ ok: boolean; archivedAt?: number; archivedListId?: string | null; keptList?: boolean; alreadyArchived?: boolean }>(
        "POST",
        `/api/icps/${slug}/archive`,
        { keepList: opts.keepList === true },
      );
      if (result.error) return fail(result.error.error);
      if (result.data.alreadyArchived) ok(`Already archived: ${slug}`);
      else if (result.data.archivedListId) ok(`Archived ICP ${slug} (also archived linked list ${result.data.archivedListId})`);
      else if (opts.keepList) ok(`Archived ICP ${slug} (kept linked list)`);
      else ok(`Archived ICP ${slug}`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  icps
    .command("restore <slug>")
    .description("Restore an archived ICP. Also restores its linked list if it was archived alongside.")
    .action(async (slug: string) => {
      const result = await api<{ ok: boolean; restoredListId?: string | null; alreadyActive?: boolean }>(
        "POST",
        `/api/icps/${slug}/restore`,
      );
      if (result.error) return fail(result.error.error);
      if (result.data.alreadyActive) ok(`Already active: ${slug}`);
      else if (result.data.restoredListId) ok(`Restored ICP ${slug} (also restored linked list ${result.data.restoredListId})`);
      else ok(`Restored ICP ${slug}`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  icps
    .command("delete <slug>")
    .description("Hard-delete an ICP and its derived list. Cannot be undone. Prefer `icps archive`.")
    .requiredOption("--yes", "Confirm deletion")
    .action(async (slug: string) => {
      const result = await api<unknown>("DELETE", `/api/icps/${slug}`);
      if (result.error) return fail(result.error.error);
      ok(`Deleted ICP ${slug}`);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });
}

export function registerIcps(program: Command): void {
  // Register under both `icps` (plural) and `icp` (singular, per v9 spec).
  buildIcpCommands(program, "icps");
  buildIcpCommands(program, "icp");
}
