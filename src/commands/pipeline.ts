import type { Command } from "commander";
import { api } from "../client.js";
import { print, fail, type Format } from "../output.js";
import {
  addPaginationOptions,
  extractPaginated,
  paginationFooter,
  paginationParams,
  type PaginationOpts,
} from "../pagination.js";

export function registerPipeline(program: Command): void {
  const pipeline = program.command("pipeline").description("View pipeline data");

  pipeline
    .command("status")
    .description("Show pipeline stage counts")
    .action(async () => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      // status aggregates over the full set — explicitly do NOT paginate
      const result = await api<unknown>("GET", "/api/pipeline");
      if (result.error) return fail(result.error.error);
      const { items } = extractPaginated<Record<string, unknown>>(result.data, "items");
      const counts: Record<string, number> = {};
      for (const item of items) {
        const stage = String(item.stage ?? "unknown");
        counts[stage] = (counts[stage] ?? 0) + 1;
      }
      print(
        Object.entries(counts).map(([stage, count]) => ({ stage, count })),
        fmt,
        {
          head: ["Stage", "Count"],
          rows: (r: { stage: string; count: number }) => [r.stage, String(r.count)],
        },
      );
    });

  const contactsCmd = pipeline
    .command("contacts")
    .description("List contacts in the pipeline")
    .option("--stage <stage>", "Filter by stage");
  addPaginationOptions(contactsCmd);
  contactsCmd.action(async (opts: PaginationOpts & { stage?: string }) => {
    const fmt: Format = program.opts().pretty ? "pretty" : "json";
    const result = await api<unknown>("GET", "/api/pipeline", undefined, paginationParams(opts));
    if (result.error) return fail(result.error.error);
    let { items, meta } = extractPaginated<Record<string, unknown>>(result.data, "items");
    if (opts.stage) items = items.filter((i) => i.stage === opts.stage);
    if (fmt === "json") {
      print(meta ? { ...((result.data as object) ?? {}), items } : items, fmt);
    } else {
      print(items, fmt, {
        head: ["ID", "Name", "Email", "Company", "Stage", "Campaign"],
        rows: (i: Record<string, unknown>) => [
          String(i.contactId ?? "").slice(0, 8),
          String(i.name ?? ""),
          String(i.email ?? ""),
          String(i.company ?? "—"),
          String(i.stage ?? ""),
          String(i.campaignName ?? ""),
        ],
      });
      const footer = paginationFooter(meta);
      if (footer) console.error(footer);
    }
  });

  pipeline
    .command("export")
    .description("Export pipeline data")
    .option("--format <format>", "Output format: json or csv", "json")
    .action(async (opts: { format: string }) => {
      // export pulls everything; explicitly do NOT paginate
      const result = await api<unknown>("GET", "/api/pipeline");
      if (result.error) return fail(result.error.error);
      const { items } = extractPaginated<Record<string, unknown>>(result.data, "items");
      if (opts.format === "csv") {
        if (items.length === 0) {
          process.stdout.write("\n");
          return;
        }
        const keys = Object.keys(items[0]);
        process.stdout.write(keys.join(",") + "\n");
        for (const item of items) {
          process.stdout.write(keys.map((k) => JSON.stringify(String(item[k] ?? ""))).join(",") + "\n");
        }
      } else {
        process.stdout.write(JSON.stringify(items, null, 2) + "\n");
      }
    });
}
