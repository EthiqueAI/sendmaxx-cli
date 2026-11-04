import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { readConfig, writeConfig } from "../config.js";
import { ok, fail } from "../output.js";

/** Trim, drop trailing slashes, and add a scheme if missing (http for localhost, else https). */
function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    const local = /^(localhost|127\.0\.0\.1)(:|$)/i.test(url);
    url = `${local ? "http" : "https"}://${url}`;
  }
  try {
    new URL(url);
  } catch {
    fail(`Invalid URL: ${raw}`);
  }
  return url;
}

/** Prompt on stderr and read a visible line from the TTY. */
async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Strips terminal escape sequences (arrow keys, bracketed-paste markers).
const ESCAPE_SEQ = /\u001b\[[0-9;?]*[A-Za-z~]/g;

/** Prompt on stderr and read a line from the TTY without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();

    let input = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk.replace(ESCAPE_SEQ, "")) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          done();
          resolve(input.trim());
          return;
        }
        if (ch === "\u0003") {
          done();
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          input = input.slice(0, -1);
        } else if (ch >= " ") {
          input += ch;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function readStdin(): Promise<string> {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

export function registerAuth(program: Command): void {
  const auth = program.command("auth").description("Manage CLI authentication");

  auth
    .command("login")
    .description("Log in to your SendMaxx instance: prompts for the URL and API token (hidden), validates, and saves to ~/.sendmaxx/config.json")
    .option("--url <url>", "Your SendMaxx URL, e.g. https://app.example.com (default: the saved URL, else prompts)")
    .option("--with-token", "Read the token from stdin instead of prompting")
    .action(async (opts: { url?: string; withToken?: boolean }) => {
      const root = program.opts();
      const interactive = Boolean(process.stdin.isTTY);
      // The root --url is consumed by the program even after the subcommand, so check both.
      const flagUrl = ((opts.url ?? root.url) as string | undefined)?.trim() || undefined;
      const savedUrl = readConfig().baseUrl;
      const urlHint = flagUrl ?? savedUrl ?? "<your SendMaxx URL>";
      const loginCmd = flagUrl ? `sendmaxx auth login --url ${flagUrl}` : "sendmaxx auth login";
      let token = (root.token as string | undefined)?.trim();

      // Check token-source flags before prompting for anything.
      if (opts.withToken) {
        if (token) fail("Use either --token or --with-token, not both.");
        if (interactive) fail(`--with-token reads from stdin; pipe the token in, e.g.: sendmaxx auth login --url ${urlHint} --with-token < token.txt`);
      } else if (!token && !interactive) {
        fail(
          `No token given and no interactive terminal to prompt in. ` +
            `Run \`${loginCmd}\` yourself in a terminal; it asks for your SendMaxx URL and API token (the token is never shown). ` +
            `Or pipe the token in: sendmaxx auth login --url ${urlHint} --with-token < token.txt`,
        );
      }

      let rawUrl = flagUrl;
      if (!rawUrl && interactive && !opts.withToken) {
        const answer = await promptLine(
          savedUrl ? `SendMaxx URL [${savedUrl}]: ` : "SendMaxx URL (e.g. https://app.example.com): ",
        );
        rawUrl = answer || savedUrl;
      }
      rawUrl ??= savedUrl;
      if (!rawUrl) fail("No SendMaxx URL given. Pass --url <your SendMaxx URL>.");
      const url = normalizeUrl(rawUrl);

      if (opts.withToken) {
        token = await readStdin();
      } else if (!token) {
        process.stderr.write(`Create an API token at ${url}/settings\n`);
        token = await promptHidden("Paste token (input hidden): ");
      }
      if (!token) fail("No token provided.");

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
          baseUrl: baseUrl ?? null,
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
