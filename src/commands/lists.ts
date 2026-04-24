import type { Command } from "commander";
import { api } from "../client.js";
import { print, fail, ok, type Format } from "../output.js";

export function registerLists(program: Command): void {
  const lists = program.command("lists").description("Manage contact lists");

  lists
    .command("list")
    .description("List all contact lists")
    .action(async () => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown[]>("GET", "/api/lists");
      if (result.error) return fail(result.error.error);
      print(result.data, fmt, {
        head: ["ID", "Name", "Members"],
        rows: (l: Record<string, unknown>) => [
          String(l.id ?? "").slice(0, 8),
          String(l.name ?? ""),
          String(l.memberCount ?? 0),
        ],
      });
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
    .description("Create a contact list")
    .requiredOption("--name <name>", "List name")
    .option("--description <desc>", "List description")
    .action(async (opts: { name: string; description?: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<unknown>("POST", "/api/lists", {
        name: opts.name,
        description: opts.description,
      });
      if (result.error) return fail(result.error.error);
      print(result.data, fmt);
    });

  lists
    .command("add <listId>")
    .description("Add contacts to a list")
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
    .description("Remove contacts from a list")
    .requiredOption("--contacts <ids>", "Comma-separated contact IDs")
    .action(async (listId: string, opts: { contacts: string }) => {
      const contactIds = opts.contacts.split(",").map((s) => s.trim());
      const result = await api<unknown>("DELETE", `/api/lists/${listId}/members`, { contactIds });
      if (result.error) return fail(result.error.error);
      ok(`Removed ${contactIds.length} contact(s) from list`);
      process.stdout.write(JSON.stringify({ ok: true, removed: contactIds.length }) + "\n");
    });
}
