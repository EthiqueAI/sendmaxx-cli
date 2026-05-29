import type { Command } from "commander";
import { readConfig, writeConfig } from "../config.js";
import { ok, fail } from "../output.js";

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Manage CLI authentication");

  auth
    .command("login")
    .description("Validate the root --token / --url and save them to ~/.sendmaxx/config.json")
    .action(async () => {
      const root = program.opts();
      const token = (root.token as string | undefined)?.trim();
      const url = ((root.url as string | undefined) ?? "http://localhost:3000").trim();
      if (!token) {
        fail("Provide --token at the root, e.g.: sendmaxx --token sm__xxx --url http://localhost:3000 auth login");
      }
      const endpoint = `${url}/api/settings`;
      try {
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          fail(`Token validation failed: ${endpoint} returned ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
        }
      } catch (err) {
        fail(`Cannot reach ${endpoint}: ${(err as Error).message}`);
      }

      writeConfig({ token, baseUrl: url });
      ok(`Authenticated. Config saved to ~/.sendmaxx/config.json`);
    });

  auth
    .command("status")
    .description("Show current auth status")
    .action(() => {
      const { token, baseUrl } = readConfig();
      if (!token) {
        process.stdout.write(JSON.stringify({ authenticated: false }) + "\n");
        return;
      }
      process.stdout.write(
        JSON.stringify({
          authenticated: true,
          baseUrl: baseUrl ?? "http://localhost:3000",
          tokenPrefix: token.slice(0, 7) + "...",
        }, null, 2) + "\n",
      );
    });

  auth
    .command("logout")
    .description("Remove stored credentials")
    .action(() => {
      writeConfig({ token: undefined, baseUrl: undefined });
      ok("Logged out.");
    });
}
