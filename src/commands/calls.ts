import type { Command } from "commander";
import { api } from "../client.js";
import { print, fail, ok, type Format } from "../output.js";
import {
  addPaginationOptions,
  extractPaginated,
  paginationFooter,
  paginationParams,
  type PaginationOpts,
} from "../pagination.js";

const OUTCOMES = ["no_answer", "not_interested", "callback", "meeting_booked"] as const;
const STATUSES = ["initiated", "ringing", "active", "completed", "failed", "no_answer"] as const;

function checkEnum(value: string | undefined, allowed: readonly string[], flag: string): void {
  if (value !== undefined && !allowed.includes(value)) {
    fail(`${flag} must be one of: ${allowed.join(", ")}`);
  }
}

function parseInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) fail(`${flag} must be a non-negative integer`);
  return n;
}

/** Accepts an ISO date or epoch milliseconds; returns epoch ms. */
function parseTime(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (Number.isNaN(ms)) fail(`${flag} must be an ISO date or epoch milliseconds`);
  return ms;
}

function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number") return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function registerCalls(program: Command): void {
  const calls = program.command("calls").description("Call log — calls placed through the dialer or logged by hand");

  const listCmd = calls
    .command("list")
    .description("List calls, newest first. Without --contact, lists calls you placed.")
    .option("--contact <id>", "Only calls to this contact")
    .option("--outcome <outcome>", `Filter by outcome: ${OUTCOMES.join(", ")}`);
  addPaginationOptions(listCmd);
  listCmd.action(async (opts: PaginationOpts & { contact?: string; outcome?: string }) => {
    const fmt: Format = program.opts().pretty ? "pretty" : "json";
    checkEnum(opts.outcome, OUTCOMES, "--outcome");
    const query = { ...paginationParams(opts), ...(opts.contact ? { contactId: opts.contact } : {}) };
    const result = await api<unknown>("GET", "/api/dialer/calls", undefined, query);
    if (result.error) return fail(result.error.error);
    let { items, meta } = extractPaginated<Record<string, unknown>>(result.data, "calls");
    if (opts.outcome) items = items.filter((c) => c.outcome === opts.outcome);
    if (fmt === "json") {
      print(meta ? { ...((result.data as object) ?? {}), calls: items } : items, fmt);
    } else {
      print(items, fmt, {
        head: ["ID", "Contact", "Number", "Status", "Outcome", "Duration", "Started"],
        rows: (c: Record<string, unknown>) => [
          String(c.id ?? ""),
          String(c.contactId ?? ""),
          String(c.phoneNumber ?? ""),
          String(c.status ?? ""),
          String(c.outcome ?? "—"),
          formatDuration(c.durationSeconds),
          c.startedAt ? new Date(Number(c.startedAt)).toLocaleString() : "—",
        ],
      });
      const footer = paginationFooter(meta);
      if (footer) console.error(footer);
    }
  });

  calls
    .command("log")
    .description("Log a call that has no record yet (e.g. made from a phone outside the dialer)")
    .requiredOption("--contact <id>", "Contact ID")
    .option("--phone <number>", "Number dialed (default: the contact's phone)")
    .option("--caller <number>", "Number called from (default: your caller number in Settings → Dialer)")
    .option("--outcome <outcome>", `Outcome: ${OUTCOMES.join(", ")}`)
    .option("--status <status>", `Status: ${STATUSES.join(", ")}`, "completed")
    .option("--notes <text>", "Call notes")
    .option("--duration <seconds>", "Talk time in seconds")
    .option("--started-at <time>", "When the call started (ISO date or epoch ms; default: now)")
    .action(async (opts: {
      contact: string;
      phone?: string;
      caller?: string;
      outcome?: string;
      status: string;
      notes?: string;
      duration?: string;
      startedAt?: string;
    }) => {
      checkEnum(opts.outcome, OUTCOMES, "--outcome");
      checkEnum(opts.status, STATUSES, "--status");
      const durationSeconds = parseInteger(opts.duration, "--duration");
      const startedAt = parseTime(opts.startedAt, "--started-at") ?? Date.now();

      let phoneNumber = opts.phone;
      if (!phoneNumber) {
        const contact = await api<{ phone?: string | null }>("GET", `/api/contacts/${opts.contact}`);
        if (contact.error) return fail(contact.error.error);
        phoneNumber = contact.data.phone ?? undefined;
        if (!phoneNumber) return fail("Contact has no phone number — pass --phone");
      }

      let callerNumber = opts.caller;
      if (!callerNumber) {
        const dialer = await api<{ phoneNumber: string | null }>("GET", "/api/dialer/token");
        if (dialer.error) return fail(dialer.error.error);
        callerNumber = dialer.data.phoneNumber ?? undefined;
        if (!callerNumber) return fail("No caller number set in Settings → Dialer — pass --caller");
      }

      const result = await api<{ id: string }>("POST", "/api/dialer/calls", {
        contactId: opts.contact,
        phoneNumber,
        callerNumber,
        status: opts.status,
        outcome: opts.outcome,
        notes: opts.notes,
        durationSeconds,
        startedAt,
        endedAt: durationSeconds !== undefined ? startedAt + durationSeconds * 1000 : undefined,
      });
      if (result.error) return fail(result.error.error);
      ok(`Logged call ${result.data.id}`);
      process.stdout.write(JSON.stringify({ ok: true, id: result.data.id }) + "\n");
    });

  calls
    .command("update <id>")
    .description("Update a call you placed — outcome, notes, status, duration")
    .option("--outcome <outcome>", `Outcome: ${OUTCOMES.join(", ")}`)
    .option("--status <status>", `Status: ${STATUSES.join(", ")}`)
    .option("--notes <text>", "Call notes (replaces existing notes)")
    .option("--duration <seconds>", "Talk time in seconds")
    .action(async (id: string, opts: { outcome?: string; status?: string; notes?: string; duration?: string }) => {
      checkEnum(opts.outcome, OUTCOMES, "--outcome");
      checkEnum(opts.status, STATUSES, "--status");
      const body: Record<string, unknown> = { id };
      if (opts.outcome !== undefined) body.outcome = opts.outcome;
      if (opts.status !== undefined) body.status = opts.status;
      if (opts.notes !== undefined) body.notes = opts.notes;
      if (opts.duration !== undefined) body.durationSeconds = parseInteger(opts.duration, "--duration");
      if (Object.keys(body).length === 1) return fail("Nothing to update — pass --outcome, --status, --notes or --duration");

      const result = await api<{ id: string }>("PATCH", "/api/dialer/calls", body);
      if (result.error) return fail(result.error.error);
      ok(`Updated call ${id}`);
      process.stdout.write(JSON.stringify({ ok: true, id }) + "\n");
    });
}
