import type { Command } from "commander";
import { readConfig, writeConfig } from "../config.js";
import { ok, fail } from "../output.js";

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
    .description("Prompt for an API token (hidden), validate it, and save it to ~/.sendmaxx/config.json")
    .option("--with-token", "Read the token from stdin instead of prompting")
    .action(async (opts: { withToken?: boolean }) => {
      const root = program.opts();
      const url = ((root.url as string | undefined) ?? "http://localhost:3000").trim();
      const loginCmd = root.url ? `sendmaxx --url ${url} auth login` : "sendmaxx auth login";
      let token = (root.token as string | undefined)?.trim();

      if (opts.withToken) {
        if (token) fail("Use either --token or --with-token, not both.");
        if (process.stdin.isTTY) fail(`--with-token reads from stdin; pipe the token in, e.g.: ${loginCmd} --with-token < token.txt`);
        token = await readStdin();
      } else if (!token) {
        if (!process.stdin.isTTY) {
          fail(
            `No token given and no interactive terminal to prompt in. ` +
              `Run \`${loginCmd}\` yourself in a terminal (the token is never shown), ` +
              `or pipe it in: ${loginCmd} --with-token < token.txt`,
          );
        }
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
