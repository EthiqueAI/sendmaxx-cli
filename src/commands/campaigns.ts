import type { Command } from "commander";
import { readFileSync } from "fs";
import { api } from "../client.js";
import { print, fail, type Format } from "../output.js";

export function registerCampaigns(program: Command): void {
  const campaigns = program.command("campaigns").description("Manage campaigns");

  campaigns
    .command("list")
    .description("List all campaigns")
    .action(async () => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ campaigns: unknown[] }>("GET", "/api/campaigns");
      if (result.error) return fail(result.error.error);
      print(result.data.campaigns, fmt, {
        head: ["ID", "Name", "Status", "Sent", "Opened", "Replied"],
        rows: (c: Record<string, unknown>) => [
          String(c.id ?? "").slice(0, 8),
          String(c.name ?? ""),
          String(c.status ?? ""),
          String(c.totalSent ?? 0),
          String(c.totalOpened ?? 0),
          String(c.totalReplied ?? 0),
        ],
      });
    });

  campaigns
    .command("get <id>")
    .description("Get campaign details")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("GET", `/api/campaigns/${id}`);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  campaigns
    .command("create")
    .description("Create a campaign")
    .requiredOption("--name <name>", "Campaign name")
    .option("--steps-file <path>", "Path to JSON file with campaign steps")
    .action(async (opts: { name: string; stepsFile?: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.stepsFile) {
        body.steps = JSON.parse(readFileSync(opts.stepsFile, "utf8"));
      }
      const result = await api<unknown>("POST", "/api/campaigns", body);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  campaigns
    .command("performance <id>")
    .description("Get campaign performance metrics")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("GET", `/api/campaigns/${id}/analytics`);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });
}
