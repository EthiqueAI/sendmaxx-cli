import type { Command } from "commander";
import { api } from "../client.js";
import { print, fail, type Format } from "../output.js";

export function registerAlerts(program: Command): void {
  program
    .command("alerts")
    .description("Show pending action items (stale contacts, untagged replies, etc.)")
    .action(async () => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";

      // Aggregate alerts from multiple endpoints
      const alerts: { type: string; count: number; message: string }[] = [];

      // Untagged replies
      const repliesResult = await api<{ count: number }>("GET", "/api/replies/count");
      if (!repliesResult.error && repliesResult.data.count > 0) {
        alerts.push({
          type: "untagged_replies",
          count: repliesResult.data.count,
          message: `${repliesResult.data.count} untagged replies need attention`,
        });
      }

      // Stale contacts (enriched_at older than 90 days)
      const contactsResult = await api<{ contacts: Record<string, unknown>[] }>("GET", "/api/contacts");
      if (!contactsResult.error) {
        const now = Date.now();
        const staleThreshold = 90 * 24 * 60 * 60 * 1000;
        const stale = contactsResult.data.contacts.filter((c) => {
          const enrichedAt = c.enrichedAt as number | null;
          return enrichedAt && now - enrichedAt > staleThreshold;
        });
        if (stale.length > 0) {
          alerts.push({
            type: "stale_contacts",
            count: stale.length,
            message: `${stale.length} contacts need re-enrichment (90+ days stale)`,
          });
        }
      }

      print(alerts, fmt, {
        head: ["Type", "Count", "Message"],
        rows: (a: { type: string; count: number; message: string }) => [a.type, String(a.count), a.message],
      });
    });

  program
    .command("stale")
    .description("List contacts that need re-enrichment")
    .option("--days <days>", "Staleness threshold in days", "90")
    .action(async (opts: { days: string }) => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ contacts: Record<string, unknown>[] }>("GET", "/api/contacts");
      if (result.error) return fail(result.error.error);

      const threshold = parseInt(opts.days) * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const stale = result.data.contacts.filter((c) => {
        const enrichedAt = c.enrichedAt as number | null;
        if (!enrichedAt) return true; // never enriched
        return now - enrichedAt > threshold;
      });

      print(stale, fmt, {
        head: ["ID", "Email", "Name", "Company", "Days Stale"],
        rows: (c: Record<string, unknown>) => {
          const enrichedAt = c.enrichedAt as number | null;
          const days = enrichedAt ? Math.floor((now - enrichedAt) / (24 * 60 * 60 * 1000)) : "never";
          return [
            String(c.id ?? "").slice(0, 8),
            String(c.email ?? ""),
            `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
            String(c.company ?? "—"),
            String(days),
          ];
        },
      });
    });
}
