import type { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { readConfig, writeConfig } from "../config.js";
import { ok, fail } from "../output.js";

/**
 * Reduce input to the instance origin: add a scheme if missing (http for
 * localhost, else https) and drop any path, so a URL pasted from the browser
 * (e.g. https://host/settings) still points at the instance root.
 */
function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) {
    const local = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
    url = `${local ? "http" : "https"}://${url}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(`Invalid URL: ${raw}`);
  }
  if (parsed.pathname.replace(/\/+$/, "") || parsed.search) {
    process.stderr.write(`Using ${parsed.origin} (the instance root; ignoring the rest of the URL)\n`);
  }
  return parsed.origin;
}

type VerifyResult =
  | { ok: true; email: string; name: string | null }
  | { ok: false; message: string };

/**
 * Ask the server who this token belongs to (GET /api/me). Only a 200 with an
 * identity counts as success: redirects aren't followed (a redirect to the
 * sign-in page would otherwise come back as a 200 HTML page), and any other
 * status or response shape is a failure.
 */
async function verifyToken(url: string, token: string): Promise<VerifyResult> {
  const endpoint = `${url}/api/me`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual",
    });
  } catch (err) {
    return { ok: false, message: `Cannot reach ${endpoint}: ${(err as Error).message}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: `Token rejected by ${url} (${res.status}). Create a new one at ${url}/settings.` };
  }
  if (res.status >= 300 && res.status < 400) {
    return {
      ok: false,
      message: `${endpoint} redirected to ${res.headers.get("location") ?? "another page"} instead of answering. Check that ${url} is your SendMaxx instance.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      message: `${endpoint} returned ${res.status} ${res.statusText}. Check that ${url} is your SendMaxx instance and that it's up to date.`,
    };
  }
  const body = (await res.json().catch(() => null)) as { email?: unknown; name?: unknown } | null;
  if (!body || typeof body.email !== "string") {
    return { ok: false, message: `${endpoint} didn't return a SendMaxx identity. Check that ${url} is your SendMaxx instance.` };
  }
  return { ok: true, email: body.email, name: typeof body.name === "string" ? body.name : null };
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

      const result = await verifyToken(url, token);
      if (!result.ok) fail(result.message);

      writeConfig({ token, baseUrl: url });
      ok(`Authenticated as ${result.email} on ${url}. Config saved to ~/.sendmaxx/config.json`);
    });

  auth
    .command("status")
    .description("Check the saved token against the server and show who it belongs to")
    .action(async () => {
      const root = program.opts();
      const config = readConfig();
      const token = (root.token as string | undefined)?.trim() || config.token;
      const rootUrl = (root.url as string | undefined)?.trim();
      const baseUrl = rootUrl ? normalizeUrl(rootUrl) : config.baseUrl;
      if (!token || !baseUrl) {
        process.stdout.write(JSON.stringify({ authenticated: false }) + "\n");
        return;
      }
      const result = await verifyToken(baseUrl, token);
      const tokenPrefix = token.slice(0, 7) + "...";
      process.stdout.write(
        JSON.stringify(
          result.ok
            ? { authenticated: true, baseUrl, user: result.email, tokenPrefix }
            : { authenticated: false, baseUrl, tokenPrefix, error: result.message },
          null,
          2,
        ) + "\n",
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
