import type { Command } from "commander";
import { api } from "../client.js";
import { print, fail, type Format } from "../output.js";

export function registerTags(program: Command): void {
  const tags = program.command("tags").description("Inspect contact tags");

  tags
    .command("list")
    .description("List all tags used on contacts, with counts")
    .action(async () => {
      const fmt: Format = program.opts().pretty ? "pretty" : "json";
      const result = await api<{ tags: unknown[] }>("GET", "/api/tags");
      if (result.error) return fail(result.error.error);
      print(result.data.tags, fmt, {
        head: ["Tag", "Total", "Claude", "User"],
        rows: (t: Record<string, unknown>) => {
          const bySource = (t.bySource ?? {}) as Record<string, number>;
          return [
            String(t.tag ?? ""),
            String(t.total ?? 0),
            String(bySource.claude ?? 0),
            String(bySource.user ?? 0),
          ];
        },
      });
    });
}
