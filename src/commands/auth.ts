import type { Command } from "commander";
import { readConfig, writeConfig } from "../config.js";
import { ok, fail } from "../output.js";

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Manage CLI authentication");

  auth
    .command("login")
    .description("Authenticate with an access token")
    .requiredOption("--token <token>", "Access token from SendMaxx settings")
    .option("--url <url>", "Base URL of your SendMaxx instance", "http://localhost:3000")
    .action(async (opts: { token: string; url: string }) => {
      // Validate the token
      try {
        const res = await fetch(`${opts.url}/api/settings`, {
          headers: { Authorization: `Bearer ${opts.token}` },
        });
        if (!res.ok) {
          fail("Token validation failed. Check your token and URL.");
        }
      } catch (err) {
        fail(`Cannot reach ${opts.url}: ${(err as Error).message}`);
      }

      writeConfig({ token: opts.token, baseUrl: opts.url });
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
