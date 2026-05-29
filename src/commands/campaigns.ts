import type { Command } from "commander";
import { readFileSync } from "fs";
import chalk from "chalk";
import { api } from "../client.js";
import { print, fail, ok, type Format } from "../output.js";
import {
  addPaginationOptions,
  extractPaginated,
  paginationFooter,
  paginationParams,
  type PaginationOpts,
} from "../pagination.js";

type CampaignStep = {
  subjectA: string;
  subjectB?: string | null;
  bodyHtml: string;
  bodyText?: string | null;
  delayDays?: number;
};

function loadSteps(stepsFile: string): CampaignStep[] {
  const parsed = JSON.parse(readFileSync(stepsFile, "utf8"));
  const arr: unknown[] = Array.isArray(parsed) ? parsed : (parsed as { steps?: unknown[] }).steps ?? [];
  if (!Array.isArray(arr) || arr.length === 0) {
    fail(`No steps found in ${stepsFile}. Expected a JSON array of { subjectA, bodyHtml, delayDays?, subjectB?, bodyText? }.`);
  }
  for (const [i, s] of arr.entries()) {
    const step = s as Partial<CampaignStep>;
    if (!step.subjectA || typeof step.subjectA !== "string") {
      fail(`Step ${i}: subjectA is required and must be a string.`);
    }
    if (!step.bodyHtml || typeof step.bodyHtml !== "string") {
      fail(`Step ${i}: bodyHtml is required and must be a string.`);
    }
  }
  return arr as CampaignStep[];
}

function splitCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

type CampaignDetail = {
  id?: string;
  name?: string;
  status?: string;
  abTestEnabled?: number | boolean;
  createdBy?: string;
  createdAt?: number;
  updatedAt?: number;
  contactCount?: number;
  totalSent?: number;
  totalOpened?: number;
  totalClicked?: number;
  totalReplied?: number;
  totalMeeting?: number;
  totalBounced?: number;
  steps?: Array<{
    stepIndex?: number;
    delayDays?: number;
    subjectA?: string;
    subjectB?: string;
    bodyText?: string;
    bodyHtml?: string;
  }>;
};

const STATUS_COLORS: Record<string, (s: string) => string> = {
  draft: chalk.gray,
  scheduled: chalk.cyan,
  active: chalk.green,
  paused: chalk.yellow,
  completed: chalk.blue,
};

function fmtDate(ms?: number): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function bar(pct: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(width - filled));
}

function preview(text: string, max = 140): string {
  const collapsed = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return collapsed.length > max ? collapsed.slice(0, max) + "…" : collapsed;
}

function renderCampaignDetail(c: CampaignDetail): string {
  const lines: string[] = [""];
  const status = c.status ?? "unknown";
  const colorStatus = (STATUS_COLORS[status] ?? chalk.white)(status.toUpperCase());

  lines.push(chalk.bold(c.name ?? "(untitled)") + "  " + colorStatus);
  lines.push(chalk.dim(c.id ?? ""));

  const meta: string[] = [];
  const created = fmtDate(c.createdAt);
  const updated = fmtDate(c.updatedAt);
  if (created) meta.push("Created " + created);
  if (updated && updated !== created) meta.push("Updated " + updated);
  if (c.contactCount != null) meta.push(`${c.contactCount} contact${c.contactCount === 1 ? "" : "s"}`);
  if (c.abTestEnabled) meta.push("A/B testing");
  if (meta.length) lines.push(chalk.dim(meta.join(" · ")));
  lines.push("");

  // Performance
  const denom = c.totalSent ?? 0;
  const pct = (n: number) => (denom > 0 ? Math.round((n / denom) * 100) : 0);
  lines.push(chalk.bold("Performance"));
  if (denom === 0) {
    lines.push(chalk.dim("  No sends yet."));
  } else {
    const rows: Array<[string, number]> = [
      ["Sent", c.totalSent ?? 0],
      ["Opened", c.totalOpened ?? 0],
      ["Clicked", c.totalClicked ?? 0],
      ["Replied", c.totalReplied ?? 0],
      ["Meetings", c.totalMeeting ?? 0],
      ["Bounced", c.totalBounced ?? 0],
    ];
    for (const [label, n] of rows) {
      const p = label === "Sent" ? 100 : pct(n);
      lines.push(`  ${label.padEnd(9)} ${String(n).padStart(5)}  ${bar(p)} ${chalk.dim(`${p}%`)}`);
    }
  }
  lines.push("");

  // Steps
  const steps = (c.steps ?? []).slice().sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
  lines.push(chalk.bold(`Steps (${steps.length})`));
  if (steps.length === 0) {
    lines.push(chalk.dim("  No steps yet."));
  } else {
    for (const [i, s] of steps.entries()) {
      const num = String(i + 1).padStart(2);
      const delay = s.delayDays === 0 || s.delayDays == null ? "Day 0" : `Day ${s.delayDays}`;
      const subj = s.subjectA ?? "(no subject)";
      lines.push(`  ${chalk.cyan(num)}  ${chalk.dim(delay.padEnd(7))}  ${chalk.bold(subj)}`);
      if (s.subjectB) lines.push(`      ${chalk.dim("B:")} ${chalk.dim(s.subjectB)}`);
      const body = s.bodyText ?? s.bodyHtml;
      if (body) lines.push(`      ${chalk.dim(preview(body))}`);
      if (i < steps.length - 1) lines.push("");
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function registerCampaigns(program: Command): void {
  const campaigns = program.command("campaigns").description("Manage campaigns");

  const listCmd = campaigns.command("list").description("List all campaigns");
  listCmd
    .option("--include-archived", "Include archived campaigns (default: active only)")
    .option("--archived-only", "Only return archived campaigns");
  addPaginationOptions(listCmd);
  listCmd.action(async (opts: PaginationOpts & { includeArchived?: boolean; archivedOnly?: boolean }) => {
    const fmt: Format = program.opts().pretty ? "pretty" : "json";
    const params = paginationParams(opts);
    if (opts.includeArchived) params.include_archived = "1";
    if (opts.archivedOnly) params.archived_only = "1";
    const result = await api<unknown>("GET", "/api/campaigns", undefined, params);
    if (result.error) return fail(result.error.error);
    const { items, meta } = extractPaginated<Record<string, unknown>>(result.data, "campaigns");
    if (fmt === "json") {
      print(result.data, fmt);
    } else {
      print(items, fmt, {
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
      const footer = paginationFooter(meta);
      if (footer) console.error(footer);
    }
  });

  campaigns
    .command("get <id>")
    .description("Get campaign details")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<CampaignDetail>("GET", `/api/campaigns/${id}`);
      if (result.error) return fail(result.error.error);
      if (fmt === "pretty") {
        console.log(renderCampaignDetail(result.data));
      } else {
        print(result.data, fmt);
      }
    });

  campaigns
    .command("create")
    .description("Create a campaign")
    .requiredOption("--name <name>", "Campaign name")
    .option("--steps-file <path>", "Path to JSON file with campaign steps (see `campaigns update --help` for schema)")
    .option("--ab-test", "Enable A/B subject testing")
    .action(async (opts: { name: string; stepsFile?: string; abTest?: boolean }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.abTest) body.abTestEnabled = true;
      if (opts.stepsFile) body.steps = loadSteps(opts.stepsFile);
      const result = await api<unknown>("POST", "/api/campaigns", body);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  campaigns
    .command("update <id>")
    .description(`Update a campaign's name, A/B flag, or steps.

  Steps schema (JSON array; sending steps REPLACES all existing steps):
    [
      {
        "subjectA":   "Quick question",                            // required (NO merge fields in subjects)
        "subjectB":   "30 seconds?",                               // optional A/B variant subject
        "bodyHtml":   "<p>Hi {{first_name}}, about {{company}}...</p>",  // required
        "bodyText":   "Hi {{first_name}}, about {{company}}...",   // optional plain-text fallback
        "delayDays":  3                                             // optional, default 0
      }
    ]

  Merge fields (case-insensitive, BODY ONLY — subjects are sent literally):
    {{first_name}}  (falls back to "there"),  {{last_name}},  {{name}},
    {{company}}     (falls back to "your company"),  {{title}}.`)
    .option("--name <name>", "New name")
    .option("--ab-test", "Enable A/B subject testing")
    .option("--no-ab-test", "Disable A/B subject testing")
    .option("--steps-file <path>", "Path to JSON file with new steps (replaces all)")
    .action(async (id: string, opts: { name?: string; abTest?: boolean; stepsFile?: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const body: Record<string, unknown> = {};
      if (opts.name !== undefined) body.name = opts.name;
      if (opts.abTest !== undefined) body.abTestEnabled = opts.abTest;
      if (opts.stepsFile) body.steps = loadSteps(opts.stepsFile);
      if (Object.keys(body).length === 0) return fail("No fields to update. Pass --name, --ab-test/--no-ab-test, or --steps-file.");
      const result = await api<unknown>("PATCH", `/api/campaigns/${id}`, body);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  campaigns
    .command("archive <id>")
    .description("Archive a campaign. Hidden from default views; restorable. If active, it's auto-paused first.")
    .action(async (id: string) => {
      const result = await api<{ ok: boolean; archivedAt?: number; autoPaused?: boolean; alreadyArchived?: boolean }>(
        "POST",
        `/api/campaigns/${id}/archive`,
      );
      if (result.error) return fail(result.error.error);
      if (result.data.alreadyArchived) ok(`Already archived: ${id}`);
      else if (result.data.autoPaused) ok(`Archived ${id} (auto-paused active campaign)`);
      else ok(`Archived ${id}`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  campaigns
    .command("restore <id>")
    .description("Restore an archived campaign. Status stays paused — use `campaigns resume` to start sending again.")
    .action(async (id: string) => {
      const result = await api<{ ok: boolean; status?: string; alreadyActive?: boolean }>(
        "POST",
        `/api/campaigns/${id}/restore`,
      );
      if (result.error) return fail(result.error.error);
      if (result.data.alreadyActive) ok(`Already active: ${id}`);
      else ok(`Restored ${id} (status: ${result.data.status ?? "unknown"})`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  campaigns
    .command("delete <id>")
    .description("Hard-delete a campaign and all its sent emails, clicks, replies. Cannot be undone. Prefer `campaigns archive`.")
    .requiredOption("--yes", "Confirm deletion")
    .action(async (id: string) => {
      const result = await api<unknown>("DELETE", `/api/campaigns/${id}`);
      if (result.error) return fail(result.error.error);
      ok(`Deleted campaign ${id}`);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });

  campaigns
    .command("launch <id>")
    .description("Launch a campaign. Sets status=active and enrolls audience for immediate send.")
    .option("--contacts <ids>", "Comma-separated contact IDs to enroll at launch (in addition to existing audience)")
    .action(async (id: string, opts: { contacts?: string }) => {
      const body: Record<string, unknown> = {};
      if (opts.contacts) body.contactIds = splitCsv(opts.contacts);
      const result = await api<{ ok: boolean; enrolled: number }>("POST", `/api/campaigns/${id}/launch`, body);
      if (result.error) return fail(result.error.error);
      ok(`Launched. ${result.data.enrolled} contact(s) enrolled.`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  campaigns
    .command("pause <id>")
    .description("Pause a campaign (status=paused). No new sends until resumed.")
    .action(async (id: string) => {
      const result = await api<unknown>("POST", `/api/campaigns/${id}/pause`);
      if (result.error) return fail(result.error.error);
      ok(`Paused ${id}`);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });

  campaigns
    .command("resume <id>")
    .description("Resume a paused campaign (status=active).")
    .action(async (id: string) => {
      const result = await api<unknown>("POST", `/api/campaigns/${id}/resume`);
      if (result.error) return fail(result.error.error);
      ok(`Resumed ${id}`);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });

  // --- audience ---------------------------------------------------------
  const audience = campaigns.command("audience").description("Manage a campaign's audience (contacts enrolled in the campaign)");

  audience
    .command("show <id>")
    .description("Show the current audience: per-contact rows and list-source summary")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ contacts: Record<string, unknown>[]; lists: Record<string, unknown>[]; individualCount?: number; totalCount?: number }>(
        "GET",
        `/api/campaigns/${id}/audience`,
      );
      if (result.error) return fail(result.error.error);
      if (fmt === "json") {
        print(result.data, fmt);
      } else {
        print(result.data.contacts, fmt, {
          head: ["CC ID", "Email", "Name", "Company", "Status", "Source list"],
          rows: (c: Record<string, unknown>) => [
            String(c.campaignContactId ?? "").slice(0, 8),
            String(c.email ?? ""),
            `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
            String(c.company ?? "—"),
            String(c.status ?? ""),
            c.sourceListId ? String(c.sourceListId).slice(0, 8) : "—",
          ],
        });
        const lists = result.data.lists ?? [];
        if (lists.length > 0) {
          console.error("\nSource lists:");
          for (const l of lists) console.error(`  ${l.listId} — ${l.name} (${l.count})`);
        }
        if (result.data.individualCount != null) {
          console.error(`\n${result.data.totalCount} total · ${result.data.individualCount} added individually`);
        }
      }
    });

  audience
    .command("add <id>")
    .description("Add contacts to a campaign's audience. Provide --contacts OR --list (or both).")
    .option("--contacts <ids>", "Comma-separated contact IDs")
    .option("--list <listId>", "List ID — snapshots current members (smart/tagged/icp lists are resolved now)")
    .action(async (id: string, opts: { contacts?: string; list?: string }) => {
      if (!opts.contacts && !opts.list) return fail("Provide --contacts and/or --list.");
      const body: Record<string, unknown> = {};
      if (opts.contacts) body.contactIds = splitCsv(opts.contacts);
      if (opts.list) body.listId = opts.list;
      const result = await api<{ ok: boolean; added: number }>("POST", `/api/campaigns/${id}/audience`, body);
      if (result.error) return fail(result.error.error);
      ok(`Added ${result.data.added} contact(s) to audience`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  audience
    .command("remove <id>")
    .description("Remove contacts from a campaign's audience. Provide --cc-ids OR --list.")
    .option("--cc-ids <ids>", "Comma-separated campaignContact IDs (from `audience show`)")
    .option("--list <listId>", "Remove all contacts sourced from this list")
    .action(async (id: string, opts: { ccIds?: string; list?: string }) => {
      if (!opts.ccIds && !opts.list) return fail("Provide --cc-ids and/or --list.");
      const body: Record<string, unknown> = {};
      if (opts.ccIds) body.campaignContactIds = splitCsv(opts.ccIds);
      if (opts.list) body.listId = opts.list;
      const result = await api<{ ok: boolean; removed: number }>("DELETE", `/api/campaigns/${id}/audience`, body);
      if (result.error) return fail(result.error.error);
      ok(`Removed ${result.data.removed} contact(s) from audience`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  // --- recipients (read-only per-recipient engagement) -----------------
  campaigns
    .command("recipients <id>")
    .description("List recipients with per-recipient engagement (sends, opens, clicks, replies)")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<Record<string, unknown>[]>("GET", `/api/campaigns/${id}/recipients`);
      if (result.error) return fail(result.error.error);
      if (fmt === "json") {
        print(result.data, fmt);
      } else {
        print(result.data, fmt, {
          head: ["Email", "Name", "Status", "Step", "Sent", "Opens", "Clicks", "Replied"],
          rows: (r: Record<string, unknown>) => [
            String(r.email ?? ""),
            `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim(),
            String(r.status ?? ""),
            String(r.currentStep ?? 0),
            String(r.emailsSent ?? 0),
            String(r.opens ?? 0),
            String(r.clicks ?? 0),
            r.replied ? "yes" : "no",
          ],
        });
      }
    });

  campaigns
    .command("recipient-stage <ccId>")
    .description("Update the stage of a single recipient (campaign-contact). Stage is a free-form label.")
    .requiredOption("--stage <stage>", "New stage label")
    .action(async (ccId: string, opts: { stage: string }) => {
      const result = await api<unknown>("PATCH", `/api/campaign-contacts/${ccId}`, { stage: opts.stage });
      if (result.error) return fail(result.error.error);
      ok(`Updated stage on ${ccId}`);
      process.stdout.write(JSON.stringify({ ok: true, ccId, stage: opts.stage }) + "\n");
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
