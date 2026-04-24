import type { Command } from "commander";
import { api } from "../client.js";
import { print, fail, ok, type Format } from "../output.js";

export function registerReplies(program: Command): void {
  const replies = program.command("replies").description("Manage replies");

  replies
    .command("list")
    .description("List all replies")
    .option("--tag <tag>", "Filter by tag: interested, meeting_booked, not_now, unsubscribed, unknown")
    .action(async (opts: { tag?: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<Record<string, unknown>[]>("GET", "/api/replies");
      if (result.error) return fail(result.error.error);
      let items = result.data;
      if (opts.tag) {
        items = items.filter((r) => r.tag === opts.tag);
      }
      print(items, fmt, {
        head: ["ID", "Contact", "Tag", "Snippet", "Received"],
        rows: (r: Record<string, unknown>) => {
          const contact = r.contact as Record<string, unknown> | undefined;
          return [
            String(r.id ?? "").slice(0, 8),
            contact ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || String(contact.email ?? "") : "—",
            String(r.tag ?? "unknown"),
            String(r.snippet ?? "").slice(0, 60),
            r.receivedAt ? new Date(r.receivedAt as number).toLocaleDateString() : "—",
          ];
        },
      });
    });

  replies
    .command("tag <id>")
    .description("Update a reply's tag")
    .requiredOption("--tag <tag>", "Tag: interested, meeting_booked, not_now, unsubscribed, unknown")
    .action(async (id: string, opts: { tag: string }) => {
      const result = await api<unknown>("PATCH", "/api/replies", { id, tag: opts.tag });
      if (result.error) return fail(result.error.error);
      ok(`Reply ${id.slice(0, 8)} tagged as ${opts.tag}`);
      process.stdout.write(JSON.stringify({ ok: true, id, tag: opts.tag }) + "\n");
    });

  replies
    .command("sync")
    .description("Trigger Gmail sync for new replies")
    .action(async () => {
      const result = await api<{ newReplies: number }>("POST", "/api/replies/sync");
      if (result.error) return fail(result.error.error);
      ok(`Synced — ${result.data.newReplies} new replies`);
      process.stdout.write(JSON.stringify(result.data) + "\n");
    });
}
