import type { Command } from "commander";
import { readFileSync } from "node:fs";
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

type EmailDetail = {
  id?: string;
  kind?: string;
  status?: string;
  subject?: string | null;
  body?: string;
  scheduledAt?: number | null;
  trackingEnabled?: number;
  personalizationNotes?: string | null;
  sources?: string | null;
  authorSource?: string;
  stepIndex?: number | null;
  gmailThreadId?: string | null;
  failureReason?: string | null;
  createdAt?: number;
  updatedAt?: number;
  contact?: { email?: string; firstName?: string | null; lastName?: string | null; company?: string | null; stage?: string } | null;
  campaign?: { id?: string; name?: string; status?: string } | null;
};

const STATUS_COLORS: Record<string, (s: string) => string> = {
  draft: chalk.gray,
  approved: chalk.cyan,
  sending: chalk.yellow,
  sent: chalk.green,
  canceled: chalk.dim,
  failed: chalk.red,
};

function fmtDate(ms?: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function contactLabel(c: EmailDetail["contact"]): string {
  if (!c) return "(unknown contact)";
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  const who = name || c.email || "(unknown)";
  return c.company ? `${who} · ${c.company}` : who;
}

function renderEmailDetail(e: EmailDetail): string {
  const lines: string[] = [""];
  const status = e.status ?? "unknown";
  lines.push(
    chalk.bold(e.subject || chalk.dim("(subject inherited from campaign step)")) +
      "  " +
      (STATUS_COLORS[status] ?? chalk.white)(status.toUpperCase())
  );
  lines.push(chalk.dim(e.id ?? ""));

  const meta: string[] = [`to ${contactLabel(e.contact)}`];
  if (e.kind && e.kind !== "standalone") meta.push(e.kind.replace("_", " "));
  if (e.authorSource === "claude") meta.push("drafted by Claude");
  if (e.trackingEnabled === 0) meta.push("tracking off");
  lines.push(chalk.dim(meta.join(" · ")));

  if (e.campaign) {
    lines.push(chalk.dim(`replaces step ${e.stepIndex} of "${e.campaign.name}" (${e.campaign.status})`));
  }
  if (e.gmailThreadId) lines.push(chalk.dim(`reply in thread ${e.gmailThreadId}`));

  const when = e.scheduledAt ? `Scheduled ${fmtDate(e.scheduledAt)}` : null;
  const updated = fmtDate(e.updatedAt);
  const times = [when, updated ? `Updated ${updated}` : null].filter(Boolean);
  if (times.length) lines.push(chalk.dim(times.join(" · ")));

  if (e.failureReason) lines.push(chalk.red(`⚠ ${e.failureReason}`));
  lines.push("");

  lines.push(chalk.bold("Body"));
  for (const line of (e.body ?? "").split("\n")) lines.push("  " + line);
  lines.push("");

  if (e.personalizationNotes) {
    lines.push(chalk.bold("Why it says that"));
    for (const line of e.personalizationNotes.split("\n")) lines.push("  " + chalk.dim(line));
    lines.push("");
  }
  if (e.sources) {
    let parsed: unknown = e.sources;
    try {
      parsed = JSON.parse(e.sources);
    } catch {
      /* leave as the raw string */
    }
    const list = Array.isArray(parsed) ? parsed.join(", ") : String(parsed);
    lines.push(chalk.bold("Sources") + " " + chalk.dim(list));
    lines.push("");
  }

  return lines.join("\n");
}

/** `--content-file` wins over `--content`, matching `icps create`. */
function resolveContent(opts: { content?: string; contentFile?: string }): string | undefined {
  if (opts.contentFile) return readFileSync(opts.contentFile, "utf-8");
  return opts.content;
}

function splitCsv(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

const CONTENT_HELP = `Body as markdown. Prefer a heredoc:
    --content "$(cat <<'EOF'
    Hey Sarah, ...
    EOF
    )"`;

function buildEmailCommands(program: Command, name: string): void {
  const emails = program
    .command(name)
    .description("Draft, review and send individually-written emails to one person");

  // ── list ────────────────────────────────────────────────────────────────
  const listCmd = emails.command("list").description("List personal emails");
  listCmd
    .option("--status <status>", "draft | approved | sending | sent | canceled | failed")
    .option("--kind <kind>", "standalone | reply | campaign_override")
    .option("--contact <id>", "Only emails to this contact")
    .option("--include-archived", "Include archived emails")
    .option("--archived-only", "Only archived emails");
  addPaginationOptions(listCmd);
  listCmd.action(
    async (
      opts: PaginationOpts & {
        status?: string;
        kind?: string;
        contact?: string;
        includeArchived?: boolean;
        archivedOnly?: boolean;
      }
    ) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const params = paginationParams(opts);
      if (opts.status) params.status = opts.status;
      if (opts.kind) params.kind = opts.kind;
      if (opts.contact) params.contact_id = opts.contact;
      if (opts.includeArchived) params.include_archived = "1";
      if (opts.archivedOnly) params.archived_only = "1";

      const result = await api<unknown>("GET", "/api/emails", undefined, params);
      if (result.error) return fail(result.error.error);

      const { items, meta } = extractPaginated<Record<string, unknown>>(result.data, "emails");
      if (fmt === "json") {
        print(result.data, fmt);
      } else {
        print(items, fmt, {
          head: ["ID", "Status", "Kind", "To", "Subject"],
          rows: (e: Record<string, unknown>) => {
            const c = e.contact as EmailDetail["contact"];
            return [
              String(e.id ?? ""),
              String(e.status ?? ""),
              String(e.kind ?? ""),
              contactLabel(c),
              String(e.subject ?? "(inherits step subject)"),
            ];
          },
        });
        const footer = paginationFooter(meta);
        if (footer) console.error(footer);
      }
    }
  );

  // ── get ─────────────────────────────────────────────────────────────────
  emails
    .command("get <id>")
    .description("Show one personal email in full")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<EmailDetail>("GET", `/api/emails/${id}`);
      if (result.error) return fail(result.error.error);
      if (fmt === "pretty") console.log(renderEmailDetail(result.data));
      else print(result.data, fmt);
    });

  // ── draft ───────────────────────────────────────────────────────────────
  emails
    .command("draft")
    .description(
      `Draft a standalone email to one contact.

  Write the actual words. Merge fields like {{first_name}} still work, but in a
  personal email they are a tell that it isn't personal — you know who this is.

  Example:
    sendmaxx emails draft --contact ct_abc --subject "Tue 2pm" --content "$(cat <<'EOF'
    Hey Sarah,

    Good talking today. Sending the auditor-portal walkthrough you asked about.
    EOF
    )" --why "She raised auditor access twice on the call"`
    )
    .requiredOption("--contact <id>", "Contact id")
    .requiredOption("--subject <subject>", "Subject line (sent literally)")
    .option("--content <markdown>", CONTENT_HELP)
    .option("--content-file <path>", "Path to a markdown file with the body")
    .option("--why <text>", "Why this email says what it says (shown in review)")
    .option("--sources <list>", "Comma-separated sources behind the personalization")
    .option("--at <iso>", "Schedule for a specific time, e.g. 2026-09-02T09:00:00Z")
    .option("--no-tracking", "Send without the tracking pixel and link rewriting")
    .action(async (opts) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const content = resolveContent(opts);
      if (!content) return fail("Body required. Pass --content or --content-file.");

      const body: Record<string, unknown> = {
        kind: "standalone",
        contactId: opts.contact,
        subject: opts.subject,
        body: content,
        trackingEnabled: opts.tracking !== false,
      };
      if (opts.why) body.personalizationNotes = opts.why;
      if (opts.sources) body.sources = splitCsv(opts.sources);
      if (opts.at) {
        const ts = Date.parse(opts.at);
        if (Number.isNaN(ts)) return fail(`--at is not a valid date: ${opts.at}`);
        body.scheduledAt = ts;
      }

      const result = await api<EmailDetail>("POST", "/api/emails", body);
      if (result.error) return fail(result.error.error);
      ok(`Drafted ${result.data.id}. Review it, then: sendmaxx emails send ${result.data.id} --yes`);
      if (fmt === "pretty") console.log(renderEmailDetail(result.data));
      else print(result.data, fmt);
    });

  // ── reply ───────────────────────────────────────────────────────────────
  emails
    .command("reply")
    .description(
      `Draft a reply into an existing Gmail thread.

  The subject and threading headers are read from the thread, so the reply lands
  in the conversation instead of starting a new one.

  Example:
    sendmaxx emails reply --contact ct_abc --thread 18f2c... --content "..."`
    )
    .requiredOption("--contact <id>", "Contact id")
    .requiredOption("--thread <gmailThreadId>", "Gmail thread to reply into")
    .option("--subject <subject>", "Override the subject (defaults to Re: the thread's)")
    .option("--content <markdown>", CONTENT_HELP)
    .option("--content-file <path>", "Path to a markdown file with the body")
    .option("--why <text>", "Why this email says what it says (shown in review)")
    .option("--at <iso>", "Schedule for a specific time")
    .option("--no-tracking", "Send without the tracking pixel and link rewriting")
    .action(async (opts) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const content = resolveContent(opts);
      if (!content) return fail("Body required. Pass --content or --content-file.");

      const body: Record<string, unknown> = {
        kind: "reply",
        contactId: opts.contact,
        gmailThreadId: opts.thread,
        body: content,
        trackingEnabled: opts.tracking !== false,
      };
      if (opts.subject) body.subject = opts.subject;
      if (opts.why) body.personalizationNotes = opts.why;
      if (opts.at) {
        const ts = Date.parse(opts.at);
        if (Number.isNaN(ts)) return fail(`--at is not a valid date: ${opts.at}`);
        body.scheduledAt = ts;
      }

      const result = await api<EmailDetail>("POST", "/api/emails", body);
      if (result.error) return fail(result.error.error);
      ok(`Drafted reply ${result.data.id}. Send with: sendmaxx emails send ${result.data.id} --yes`);
      if (fmt === "pretty") console.log(renderEmailDetail(result.data));
      else print(result.data, fmt);
    });

  // ── override ────────────────────────────────────────────────────────────
  emails
    .command("override")
    .description(
      `Replace a campaign step's body for ONE recipient with bespoke text.

  The campaign still sends it, on its own schedule. Get campaignContact ids from
  \`sendmaxx campaigns recipients <campaignId>\`.

  This is for the handful of people who deserve individual words. If more than a
  few recipients need custom text, that's a different campaign, not overrides.`
    )
    .requiredOption("--campaign-contact <ccId>", "campaignContact (enrollment) id")
    .requiredOption("--step <n>", "Step index to replace (0-based)")
    .option("--subject <subject>", "Override the subject too (defaults to the step's)")
    .option("--content <markdown>", CONTENT_HELP)
    .option("--content-file <path>", "Path to a markdown file with the body")
    .option("--why <text>", "Why this email says what it says (shown in review)")
    .action(async (opts) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const content = resolveContent(opts);
      if (!content) return fail("Body required. Pass --content or --content-file.");

      const stepIndex = parseInt(opts.step, 10);
      if (Number.isNaN(stepIndex) || stepIndex < 0) return fail("--step must be a non-negative integer");

      const body: Record<string, unknown> = {
        kind: "campaign_override",
        campaignContactId: opts.campaignContact,
        stepIndex,
        body: content,
      };
      if (opts.subject) body.subject = opts.subject;
      if (opts.why) body.personalizationNotes = opts.why;

      const result = await api<EmailDetail>("POST", "/api/emails", body);
      if (result.error) return fail(result.error.error);
      ok(`Override drafted (${result.data.id}). Approve it with: sendmaxx emails send ${result.data.id} --yes`);
      if (fmt === "pretty") console.log(renderEmailDetail(result.data));
      else print(result.data, fmt);
    });

  // ── update ──────────────────────────────────────────────────────────────
  emails
    .command("update <id>")
    .description("Edit a draft. Editing an approved email returns it to draft.")
    .option("--subject <subject>", "New subject")
    .option("--content <markdown>", CONTENT_HELP)
    .option("--content-file <path>", "Path to a markdown file with the body")
    .option("--why <text>", "Replace the personalization note")
    .option("--at <iso>", "Reschedule")
    .option("--tracking", "Enable tracking")
    .option("--no-tracking", "Disable tracking")
    .action(async (id: string, opts) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const body: Record<string, unknown> = {};
      if (opts.subject !== undefined) body.subject = opts.subject;
      const content = resolveContent(opts);
      if (content !== undefined) body.body = content;
      if (opts.why !== undefined) body.personalizationNotes = opts.why;
      if (opts.at) {
        const ts = Date.parse(opts.at);
        if (Number.isNaN(ts)) return fail(`--at is not a valid date: ${opts.at}`);
        body.scheduledAt = ts;
      }
      // commander only sets `tracking` when one of the two flags was passed.
      if (opts.tracking !== undefined) body.trackingEnabled = opts.tracking;

      if (Object.keys(body).length === 0) {
        return fail("No fields to update. Pass --subject, --content, --why, --at, or --tracking/--no-tracking.");
      }

      const result = await api<EmailDetail>("PATCH", `/api/emails/${id}`, body);
      if (result.error) return fail(result.error.error);
      ok(`Updated ${id}`);
      if (fmt === "pretty") console.log(renderEmailDetail(result.data));
      else print(result.data, fmt);
    });

  // ── send ────────────────────────────────────────────────────────────────
  emails
    .command("send <id>")
    .description(
      `Approve an email for sending. Requires --yes.

  By default it becomes due work the scheduler picks up, inheriting the send
  window, daily cap and throttle. --now sends immediately, bypassing only the
  send-hour window.

  Never run this without the user explicitly approving THIS email. A general
  "go ahead" earlier in the session does not authorize a specific send.`
    )
    .requiredOption("--yes", "Confirm you are releasing this email to a real person")
    .option("--now", "Send immediately instead of waiting for the next tick")
    .action(async (id: string, opts: { now?: boolean }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ ok?: boolean; sent?: boolean; queued?: string; note?: string }>(
        "POST",
        `/api/emails/${id}/send`,
        { now: opts.now === true }
      );
      if (result.error) return fail(result.error.error);
      if (result.data.sent) ok(`Sent ${id}`);
      else if (result.data.queued === "campaign") ok(result.data.note ?? `Approved ${id}`);
      else ok(`Approved ${id} — the scheduler will send it on the next tick`);
      print(result.data, fmt);
    });

  // ── cancel ──────────────────────────────────────────────────────────────
  emails
    .command("cancel <id>")
    .description("Cancel a draft or approved email so it never sends")
    .option("--reason <text>", "Why")
    .action(async (id: string, opts: { reason?: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<EmailDetail>("POST", `/api/emails/${id}/cancel`, { reason: opts.reason });
      if (result.error) return fail(result.error.error);
      ok(`Canceled ${id}`);
      print(result.data, fmt);
    });

  // ── archive / restore / delete ──────────────────────────────────────────
  emails
    .command("archive <id>")
    .description("Archive an email. Reversible — prefer this over delete.")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("POST", `/api/emails/${id}/archive`);
      if (result.error) return fail(result.error.error);
      ok(`Archived ${id}`);
      print(result.data, fmt);
    });

  emails
    .command("restore <id>")
    .description("Restore an archived email")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("POST", `/api/emails/${id}/restore`);
      if (result.error) return fail(result.error.error);
      ok(`Restored ${id}`);
      print(result.data, fmt);
    });

  emails
    .command("delete <id>")
    .description("Hard-delete an email. Cannot be undone. Prefer `emails archive`.")
    .requiredOption("--yes", "Confirm deletion")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("DELETE", `/api/emails/${id}`);
      if (result.error) return fail(result.error.error);
      ok(`Deleted ${id}`);
      print(result.data, fmt);
    });
}

export function registerEmails(program: Command): void {
  // Register under both `emails` (plural) and `email` (singular, per v9 spec).
  buildEmailCommands(program, "emails");
  buildEmailCommands(program, "email");
}
