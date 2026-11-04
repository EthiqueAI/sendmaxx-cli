import type { Command } from "commander";
import { readFileSync } from "fs";
import { extname } from "path";
import { api } from "../client.js";
import { print, fail, ok, type Format } from "../output.js";
import {
  addPaginationOptions,
  extractPaginated,
  paginationFooter,
  paginationParams,
  type PaginationOpts,
} from "../pagination.js";

// --- import helpers -------------------------------------------------------

const ALLOWED_FIELDS = ["email", "firstName", "lastName", "company", "title", "phone", "state", "county", "notes"] as const;
type ImportRow = Partial<Record<(typeof ALLOWED_FIELDS)[number], string>>;

// Maps a normalized header (lowercase, alphanumeric only) to a canonical field.
const HEADER_ALIASES: Record<string, (typeof ALLOWED_FIELDS)[number]> = {
  email: "email",
  emailaddress: "email",
  firstname: "firstName",
  givenname: "firstName",
  fname: "firstName",
  lastname: "lastName",
  surname: "lastName",
  familyname: "lastName",
  lname: "lastName",
  company: "company",
  companyname: "company",
  organization: "company",
  org: "company",
  employer: "company",
  title: "title",
  jobtitle: "title",
  role: "title",
  position: "title",
  phone: "phone",
  phonenumber: "phone",
  mobile: "phone",
  tel: "phone",
  state: "state",
  province: "state",
  region: "state",
  county: "county",
  notes: "notes",
  note: "notes",
  comments: "notes",
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Minimal RFC 4180-ish CSV parser: handles quoted fields and "" escapes. */
function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch;
    i++;
  }
  // Flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.length > 0));
}

function mapCsvToRows(csvText: string, userMapping?: Record<string, string>): ImportRow[] {
  const grid = parseCsv(csvText);
  if (grid.length === 0) return [];
  const headers = grid[0];
  // Resolve each column to a canonical field (or null = ignore).
  const resolved: (keyof ImportRow | null)[] = headers.map((h) => {
    if (userMapping) {
      const direct = userMapping[h] ?? userMapping[h.trim()];
      if (direct) {
        if (!ALLOWED_FIELDS.includes(direct as (typeof ALLOWED_FIELDS)[number])) {
          fail(`Mapping target "${direct}" for column "${h}" is not a valid field. Allowed: ${ALLOWED_FIELDS.join(", ")}.`);
        }
        return direct as keyof ImportRow;
      }
    }
    const canonical = HEADER_ALIASES[normalizeHeader(h)];
    return canonical ?? null;
  });

  return grid.slice(1).map((cells) => {
    const row: ImportRow = {};
    for (let i = 0; i < cells.length; i++) {
      const field = resolved[i];
      const value = cells[i];
      if (!field || !value) continue;
      row[field] = value;
    }
    return row;
  });
}

function loadJsonRows(jsonText: string): ImportRow[] {
  const parsed = JSON.parse(jsonText);
  const arr: unknown[] = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown[] }).rows ?? [];
  if (!Array.isArray(arr)) {
    fail("JSON file must be an array of contact objects, or { rows: [...] }.");
  }
  return arr.map((r) => {
    const row = r as Record<string, unknown>;
    const out: ImportRow = {};
    for (const k of ALLOWED_FIELDS) {
      const v = row[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  });
}

export function registerContacts(program: Command): void {
  const contacts = program.command("contacts").description("Manage contacts");

  const searchCmd = contacts
    .command("search")
    .description("Search contacts")
    .option("--query <text>", "Full-text search")
    .option("--stage <stage>", "Filter by stage")
    .option("--state <state>", "Filter by US state")
    .option("--county <county>", "Filter by county")
    .option("--company <company>", "Filter by company")
    .option("--title <title>", "Filter by title")
    .option("--tag <tag>", "Filter by contact tag")
    .option("--min-confidence <score>", "Filter contacts with confidence >= score (0-10)")
    .option("--include-archived", "Include archived contacts in results (default: active only)")
    .option("--archived-only", "Only return archived contacts")
    .option("--save-as <name>", "Save the current filter as a smart list with this name");
  addPaginationOptions(searchCmd);
  searchCmd.action(async (opts) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";

      // If --save-as, build the query JSON and create a smart list directly.
      if (opts.saveAs) {
        const query: Record<string, unknown> = {};
        if (opts.query) query.search = opts.query;
        if (opts.stage) query.stage = [opts.stage];
        if (opts.state) query.state = [opts.state];
        if (opts.county) query.county = [opts.county];
        if (opts.company) query.company = [opts.company];
        if (opts.title) query.title = [opts.title];
        if (opts.tag) query.has_tag = opts.tag;
        if (opts.minConfidence != null) query.confidence_score_gte = Number(opts.minConfidence);

        const result = await api<unknown>("POST", "/api/lists", {
          name: opts.saveAs,
          type: "smart",
          query: JSON.stringify(query),
        });
        if (result.error) return fail(result.error.error);
        ok(`Smart list "${opts.saveAs}" created`);
        print(result.data, fmt);
        return;
      }

      const params: Record<string, string> = {
        search: opts.query ?? "",
        stage: opts.stage ?? "",
        state: opts.state ?? "",
        county: opts.county ?? "",
        company: opts.company ?? "",
        title: opts.title ?? "",
        ...paginationParams(opts as PaginationOpts),
      };
      if (opts.tag) params.tag = opts.tag;
      if (opts.minConfidence != null) params.min_confidence = String(opts.minConfidence);
      if (opts.includeArchived) params.include_archived = "1";
      if (opts.archivedOnly) params.archived_only = "1";

      const result = await api<unknown>("GET", "/api/contacts", undefined, params);
      if (result.error) return fail(result.error.error);

      const { items, meta } = extractPaginated<Record<string, unknown>>(result.data, "contacts");
      if (fmt === "json") {
        // Pass through full payload (preserves meta + orgMode for callers that want them)
        print(result.data, fmt);
      } else {
        print(items, fmt, {
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
        const footer = paginationFooter(meta);
        if (footer) console.error(footer);
      }
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
    .command("import")
    .description(`Bulk import contacts from a CSV or JSON file. Dedupes by email.

  Allowed fields (other columns are ignored):
    email (required for each row), firstName, lastName, company, title, phone, state, county, notes

  CSV: first row is the header. Common column-name variants are auto-mapped
       (e.g. "Email Address" → email, "First Name" → firstName, "Job Title" → title,
        "organization" → company, "phone_number" → phone). Use --mapping to override.

  JSON: an array of contact objects, or { "rows": [ {...}, {...} ] }.

  Examples:
    sendmaxx contacts import --file leads.csv
    sendmaxx contacts import --file leads.csv --mapping '{"Lead Email":"email","Org":"company"}'
    sendmaxx contacts import --file leads.json --format json --dry-run`)
    .option("--file <path>", "Path to a CSV or JSON file")
    .option("--format <fmt>", "csv | json (auto-detected from file extension if omitted)")
    .option("--mapping <jsonOrPath>", "Column-to-field mapping JSON string, or path to a JSON file")
    .option("--dry-run", "Parse and validate the file but do not send it")
    .action(async (opts: { file?: string; format?: string; mapping?: string; dryRun?: boolean }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      if (!opts.file) return fail("Provide --file <path>.");
      const text = readFileSync(opts.file, "utf8");
      const ext = extname(opts.file).toLowerCase();
      const format = opts.format ?? (ext === ".json" ? "json" : ext === ".csv" ? "csv" : null);
      if (!format) return fail("Could not detect format from extension. Pass --format csv|json.");

      let userMapping: Record<string, string> | undefined;
      if (opts.mapping) {
        const raw = opts.mapping.trim().startsWith("{")
          ? opts.mapping
          : readFileSync(opts.mapping, "utf8");
        try {
          userMapping = JSON.parse(raw) as Record<string, string>;
        } catch {
          return fail("--mapping is not valid JSON.");
        }
      }

      const rows = format === "csv" ? mapCsvToRows(text, userMapping) : loadJsonRows(text);
      const withEmail = rows.filter((r) => r.email && r.email.includes("@"));
      const dropped = rows.length - withEmail.length;

      if (opts.dryRun) {
        const preview = withEmail.slice(0, 3);
        process.stdout.write(JSON.stringify({
          parsed: rows.length,
          importable: withEmail.length,
          droppedNoEmail: dropped,
          preview,
        }, null, 2) + "\n");
        return;
      }

      if (withEmail.length === 0) return fail(`No rows with a valid email found. Parsed ${rows.length} row(s).`);

      const result = await api<{ imported: number; skipped: number; errors: string[] }>(
        "POST",
        "/api/contacts/import",
        { rows: withEmail },
      );
      if (result.error) return fail(result.error.error);
      ok(`Imported ${result.data.imported}, skipped ${result.data.skipped}${dropped > 0 ? `, dropped ${dropped} without email` : ""}`);
      print(result.data, fmt);
    });

  contacts
    .command("bulk-delete")
    .description("Delete many contacts in one call. Cannot be undone.")
    .option("--ids <ids>", "Comma-separated contact IDs")
    .option("--file <path>", "File with one contact ID per line")
    .requiredOption("--yes", "Confirm deletion")
    .action(async (opts: { ids?: string; file?: string }) => {
      let ids: string[] = [];
      if (opts.ids) ids = opts.ids.split(",").map((s) => s.trim()).filter(Boolean);
      else if (opts.file) ids = readFileSync(opts.file, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      else return fail("Provide --ids or --file.");
      if (ids.length === 0) return fail("No IDs to delete.");

      const result = await api<{ deleted: number }>("DELETE", "/api/contacts/bulk", { ids });
      if (result.error) return fail(result.error.error);
      ok(`Deleted ${result.data.deleted} contact(s)`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
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
    .command("archive <id>")
    .description("Archive a contact. Hidden from default views; restorable. Scheduler skips it across all campaigns.")
    .action(async (id: string) => {
      const result = await api<{ ok: boolean; archivedAt?: number; alreadyArchived?: boolean }>(
        "POST",
        `/api/contacts/${id}/archive`,
      );
      if (result.error) return fail(result.error.error);
      ok(result.data.alreadyArchived ? `Already archived: ${id}` : `Archived ${id}`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  contacts
    .command("restore <id>")
    .description("Restore an archived contact. Becomes visible again; scheduler resumes any pending enrollments.")
    .action(async (id: string) => {
      const result = await api<{ ok: boolean; alreadyActive?: boolean }>("POST", `/api/contacts/${id}/restore`);
      if (result.error) return fail(result.error.error);
      ok(result.data.alreadyActive ? `Already active: ${id}` : `Restored ${id}`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });

  contacts
    .command("delete <id>")
    .description("Hard-delete a contact. Cannot be undone. Prefer `contacts archive` unless you really mean to wipe the row + all linked enrollments/emails/replies.")
    .requiredOption("--yes", "Confirm deletion")
    .action(async (id: string) => {
      const result = await api<unknown>("DELETE", `/api/contacts/${id}`);
      if (result.error) return fail(result.error.error);
      ok(`Deleted ${id}`);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    });

  contacts
    .command("tag <id>")
    .description("Add one or more tags to a contact")
    .requiredOption("--tag <tags>", "Tag, or comma-separated list of tags (e.g. 'event:saastr_2026')")
    .option("--source <source>", "user | claude (default: claude when token-auth)")
    .option("--confidence <score>", "0..1 confidence (Claude attribution)")
    .option("--reasoning <text>", "Why this tag applies (Claude attribution)")
    .action(
      async (
        id: string,
        opts: { tag: string; source?: string; confidence?: string; reasoning?: string },
      ) => {
        const tags = opts.tag.split(",").map((s) => s.trim()).filter(Boolean);
        const body: Record<string, unknown> = { tags };
        if (opts.source) body.source = opts.source;
        if (opts.confidence != null) body.confidence = Number(opts.confidence);
        if (opts.reasoning) body.reasoning = opts.reasoning;
        const result = await api<unknown>("POST", `/api/contacts/${id}/tags`, body);
        if (result.error) return fail(result.error.error);
        ok(`Tagged ${tags.length} on ${id}`);
        process.stdout.write(JSON.stringify({ ok: true, added: tags.length }) + "\n");
      },
    );

  contacts
    .command("untag <id>")
    .description("Remove one or more tags from a contact")
    .requiredOption("--tag <tags>", "Tag, or comma-separated list of tags")
    .action(async (id: string, opts: { tag: string }) => {
      const tags = opts.tag.split(",").map((s) => s.trim()).filter(Boolean);
      const result = await api<unknown>("DELETE", `/api/contacts/${id}/tags`, { tags });
      if (result.error) return fail(result.error.error);
      ok(`Removed ${tags.length} tag(s) from ${id}`);
      process.stdout.write(JSON.stringify({ ok: true, removed: tags.length }) + "\n");
    });

  contacts
    .command("timeline <id>")
    .description("Show a contact's activity, oldest first: enrolments, sends, opens, clicks, replies")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ contact: unknown; events: Record<string, unknown>[] }>("GET", `/api/contacts/${id}/timeline`);
      if (result.error) return fail(result.error.error);
      if (fmt === "json") return print(result.data, fmt);
      print(result.data.events, fmt, {
        head: ["When", "Event", "Detail"],
        rows: (e: Record<string, unknown>) => [
          e.timestamp ? new Date(Number(e.timestamp)).toLocaleString() : "—",
          String(e.label ?? e.type ?? ""),
          String(e.meta ?? ""),
        ],
      });
    });

  contacts
    .command("tags <id>")
    .description("List tags on a contact")
    .action(async (id: string) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ tags: unknown[] }>("GET", `/api/contacts/${id}/tags`);
      if (result.error) return fail(result.error.error);
      print(result.data.tags, fmt, {
        head: ["Tag", "Source", "Confidence", "Set at"],
        rows: (t: Record<string, unknown>) => [
          String(t.tag ?? ""),
          String(t.source ?? ""),
          t.confidence != null ? String(t.confidence) : "—",
          t.setAt ? new Date(Number(t.setAt)).toISOString() : "—",
        ],
      });
    });
}
