import type { Command } from "commander";
import { readFileSync } from "fs";
import { api } from "../client.js";
import { print, fail, ok, type Format } from "../output.js";

export function registerContacts(program: Command): void {
  const contacts = program.command("contacts").description("Manage contacts");

  contacts
    .command("search")
    .description("Search contacts")
    .option("--query <text>", "Full-text search")
    .option("--stage <stage>", "Filter by stage")
    .option("--state <state>", "Filter by US state")
    .option("--county <county>", "Filter by county")
    .option("--company <company>", "Filter by company")
    .option("--title <title>", "Filter by title")
    .action(async (opts) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ contacts: unknown[] }>("GET", "/api/contacts", undefined, {
        search: opts.query ?? "",
        stage: opts.stage ?? "",
        state: opts.state ?? "",
        county: opts.county ?? "",
        company: opts.company ?? "",
        title: opts.title ?? "",
      });
      if (result.error) return fail(result.error.error);
      print(result.data.contacts, fmt, {
        head: ["ID", "Email", "Name", "Company", "Stage", "Score"],
        rows: (c: Record<string, unknown>) => [
          String(c.id ?? "").slice(0, 8),
          String(c.email ?? ""),
          `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
          String(c.company ?? "—"),
          String(c.stage ?? ""),
          c.confidenceScore != null ? String(c.confidenceScore) : "—",
        ],
      });
    });

  contacts
    .command("get <id>")
    .description("Get a contact by ID with interaction history")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("GET", `/api/contacts/${id}`);
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  contacts
    .command("add")
    .description("Add a contact (--json) or bulk import (--file)")
    .option("--json <json>", "Contact as JSON string")
    .option("--file <path>", "Path to JSON file (single object or array)")
    .action(async (opts: { json?: string; file?: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      let payload: unknown;
      if (opts.file) {
        payload = JSON.parse(readFileSync(opts.file, "utf8"));
      } else if (opts.json) {
        payload = JSON.parse(opts.json);
      } else {
        return fail("Provide --json or --file");
      }

      if (Array.isArray(payload)) {
        const results: unknown[] = [];
        for (const item of payload) {
          const r = await api<unknown>("POST", "/api/contacts", item);
          results.push(r.error ? { ...(item as object), _error: r.error.error } : r.data);
        }
        print(results, fmt);
        const errors = results.filter((r) => (r as Record<string, unknown>)._error);
        if (errors.length > 0) {
          ok(`${results.length - errors.length} added, ${errors.length} failed`);
          process.exit(1);
        }
        ok(`${results.length} contacts added`);
      } else {
        const result = await api<unknown>("POST", "/api/contacts", payload);
        if (result.error) return fail(result.error.error);
        print(result.data, fmt);
      }
    });

  contacts
    .command("update <id>")
    .description("Update a contact's fields")
    .requiredOption("--json <json>", "Fields to update as JSON string")
    .action(async (id: string, opts: { json: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("PATCH", `/api/contacts/${id}`, JSON.parse(opts.json));
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  contacts
    .command("update-stage <id>")
    .description("Update a contact's pipeline stage")
    .requiredOption("--stage <stage>", "Stage: new, sent, opened, replied, meeting_booked, called, bounced, unsubscribed")
    .action(async (id: string, opts: { stage: string }) => {
      const result = await api<unknown>("PATCH", `/api/contacts/${id}`, { stage: opts.stage });
      if (result.error) return fail(result.error.error);
      process.stdout.write(JSON.stringify({ ok: true, id, stage: opts.stage }) + "\n");
    });

  contacts
    .command("delete <id>")
    .description("Delete a contact")
    .action(async (id: string) => {
      const result = await api<unknown>("DELETE", `/api/contacts/${id}`);
      if (result.error) return fail(result.error.error);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });
}
