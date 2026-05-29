# SendMaxx CLI

`sendmaxx` is the command-line interface for [SendMaxx](https://github.com/EthiqueAI). It talks to your SendMaxx instance over the same REST API the web app uses, and is designed to be driven both by humans and by AI agents (Claude Code, Claude Desktop) via MCP-style scripting.

By default every command emits JSON on stdout — easy to pipe through `jq`, parse from a script, or feed back into another tool. Pass `--pretty` for a human-readable table.

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Global options](#global-options)
- [Output format](#output-format)
- [Pagination](#pagination)
- [Configuration](#configuration)
- [Commands](#commands)
  - [`auth`](#auth) — login, status, logout
  - [`contacts`](#contacts) — search, get, add, update, tag, delete
  - [`campaigns`](#campaigns) — list, get, create, performance
  - [`lists`](#lists) — manual, smart, tagged, icp lists
  - [`tags`](#tags) — inspect tags across contacts
  - [`icps`](#icps) — ideal customer profiles
  - [`pipeline`](#pipeline) — pipeline status & export
  - [`replies`](#replies) — manage and sync replies
  - [`alerts`](#alerts) / [`stale`](#stale) — action items
- [Examples](#examples)
- [Exit codes](#exit-codes)

---

## Install

### Option A — from the registry (recommended for end users)

The package is published to the GitHub Package Registry under `@ethiqueai/cli`. Configure npm to use the registry for that scope, then install globally:

```bash
npm install -g @ethiqueai/cli
sendmaxx --version
```

### Option B — from source (recommended while developing the CLI)

```bash
git clone https://github.com/EthiqueAI/sendmaxx-cli.git
cd sendmaxx-cli
npm install
npm run build

# Use it via node:
node ./dist/index.js --help

# Or symlink it onto your PATH:
npm link
sendmaxx --help
```

For an active dev loop, `npm run dev` runs `tsup` in watch mode so each save rebuilds `dist/`.

---

## Quick start

```bash
# 1. Authenticate against your SendMaxx instance.
#    --token and --url are root-level flags; place them BEFORE the subcommand.
sendmaxx --token sk_xxx --url http://localhost:3000 auth login

# 2. Confirm.
sendmaxx auth status

# 3. Do something.
sendmaxx contacts search --query "acme" --pretty
sendmaxx campaigns list --pretty
sendmaxx pipeline status --pretty
```

---

## Global options

These flags work on any command:

| Flag | Description |
|------|-------------|
| `--token <token>` | API token. Overrides whatever is stored in config. |
| `--url <url>` | Base URL of the SendMaxx instance. Overrides config. |
| `--pretty` | Render output as a formatted table instead of JSON. |
| `--help` | Show help for the current command. |
| `--version` | Print CLI version. |

Use `--token` / `--url` for one-off invocations (e.g. CI scripts that target a staging instance) without disturbing your local config.

---

## Output format

- **Default:** structured JSON on stdout. Ideal for `jq`, scripting, and agents.
- **`--pretty`:** human-readable table. Pagination footers (when applicable) print to **stderr** so they don't pollute piped output.
- **Status messages** (success/failure banners) also go to stderr.

Example:

```bash
sendmaxx contacts search --query acme | jq '.contacts[].email'
sendmaxx contacts search --query acme --pretty
```

---

## Pagination

List/search commands accept `--limit` and `--offset`:

| Flag | Description |
|------|-------------|
| `--limit <n>` | Page size. Opts the command into pagination. Server default is 50; max is 500. |
| `--offset <n>` | Number of results to skip. Requires `--limit`. Defaults to 0. |

Without `--limit`, the server returns its legacy non-paginated shape. With `--limit`, JSON output includes `total`, `limit`, `offset`, and `hasMore` fields; `--pretty` output adds a footer like `Showing 1–50 of 213 · more available (offset 50)`.

```bash
sendmaxx contacts search --limit 100
sendmaxx contacts search --limit 100 --offset 100
```

---

## Configuration

Credentials and base URL are stored at `~/.sendmaxx/config.json`:

```json
{
  "token": "sk_...",
  "baseUrl": "http://localhost:3000"
}
```

The file is written by `sendmaxx auth login` and removed by `sendmaxx auth logout`. You can edit it by hand if you need to.

---

## Commands

### `auth`

Manage CLI authentication.

#### `auth login`
Authenticate with an access token. Validates the token against `/api/settings` before saving.

```bash
sendmaxx auth login --token <token> [--url <url>]
```

- `--token <token>` *(required)* — access token from SendMaxx settings.
- `--url <url>` — base URL of your instance. Defaults to `http://localhost:3000`.

#### `auth status`
Print current auth state (authenticated flag, base URL, masked token prefix).

```bash
sendmaxx auth status
```

#### `auth logout`
Remove stored credentials.

```bash
sendmaxx auth logout
```

---

### `contacts`

Manage contacts in your CRM.

#### `contacts search`
Search and filter contacts. Supports server-side pagination.

```bash
sendmaxx contacts search [filters] [--limit N --offset M]
```

Filters:

| Flag | Description |
|------|-------------|
| `--query <text>` | Full-text search across name/email/company. |
| `--stage <stage>` | Pipeline stage (e.g. `new`, `sent`, `replied`). |
| `--state <state>` | US state. |
| `--county <county>` | County. |
| `--company <company>` | Company name. |
| `--title <title>` | Job title. |
| `--tag <tag>` | Contact tag (e.g. `event:saastr_2026`). |
| `--min-confidence <0-10>` | Only contacts with `confidenceScore >= N`. |
| `--save-as <name>` | Instead of returning results, save the current filter as a **smart list** with this name. |

#### `contacts get <id>`
Fetch a contact (with interaction history).

```bash
sendmaxx contacts get abc123
```

#### `contacts add`
Add a single contact or bulk-import from a file. Provide exactly one of `--json` or `--file`. If the payload is an array, contacts are added sequentially and any per-row errors are reported with a non-zero exit code.

```bash
sendmaxx contacts add --json '{"email":"a@b.com","firstName":"Ada"}'
sendmaxx contacts add --file contacts.json
```

#### `contacts update <id>`
Patch fields on a contact.

```bash
sendmaxx contacts update abc123 --json '{"title":"VP Engineering"}'
```

#### `contacts update-stage <id>`
Shortcut for moving a contact through the pipeline.

```bash
sendmaxx contacts update-stage abc123 --stage meeting_booked
```

Valid stages: `new`, `sent`, `opened`, `replied`, `meeting_booked`, `called`, `bounced`, `unsubscribed`.

#### `contacts delete <id>`
Delete a contact.

```bash
sendmaxx contacts delete abc123
```

#### `contacts tag <id>`
Add one or more tags to a contact. Pass multiple tags comma-separated.

```bash
sendmaxx contacts tag abc123 --tag event:saastr_2026
sendmaxx contacts tag abc123 --tag "event:saastr_2026,segment:enterprise" \
  --source claude --confidence 0.85 --reasoning "Title and LinkedIn match enterprise ICP"
```

- `--tag <tags>` *(required)* — single tag or comma-separated list.
- `--source <user|claude>` — attribution. Defaults to `claude` when using a token.
- `--confidence <0..1>` — Claude attribution confidence.
- `--reasoning <text>` — why this tag applies.

#### `contacts untag <id>`
Remove one or more tags.

```bash
sendmaxx contacts untag abc123 --tag event:saastr_2026
```

#### `contacts tags <id>`
List the tags currently on a contact (with source, confidence, and timestamp).

```bash
sendmaxx contacts tags abc123 --pretty
```

---

### `campaigns`

Manage outreach campaigns.

#### `campaigns list`
List all campaigns. Supports pagination.

```bash
sendmaxx campaigns list --pretty
```

#### `campaigns get <id>`
Get full details on a campaign (steps, schedule, audience).

```bash
sendmaxx campaigns get cmp_abc
```

#### `campaigns create`
Create a campaign. Steps are supplied as a JSON file matching the campaign-steps schema.

```bash
sendmaxx campaigns create --name "SaaStr 2026 Outbound" --steps-file ./steps.json
```

#### `campaigns performance <id>`
Get performance metrics for a campaign (sends, opens, replies, conversions, etc.).

```bash
sendmaxx campaigns performance cmp_abc
```

---

### `lists`

Manage contact lists. SendMaxx supports four kinds:

- **manual** — explicit set of contacts you add/remove.
- **smart** — defined by a query; membership recomputed live.
- **tagged** — auto-populated by everyone with a given tag.
- **icp** — derived from an ICP doc.

#### `lists list`
List all lists. Supports pagination.

```bash
sendmaxx lists list --pretty
```

#### `lists get <id>`
List details, including current members.

```bash
sendmaxx lists get lst_abc
```

#### `lists create`
Create a list of any type. Required flags depend on type:

```bash
# Manual
sendmaxx lists create --name "Q2 hand-picked"

# Smart
sendmaxx lists create --name "Enterprise VPs" --type smart \
  --query '{"title":["VP Engineering","CTO"],"state":["CA","NY"]}'

# Smart, from a JSON file
sendmaxx lists create --name "Stale enterprise" --type smart --query-file ./query.json

# Tagged
sendmaxx lists create --name "SaaStr attendees" --type tagged --tag event:saastr_2026

# ICP-derived
sendmaxx lists create --name "Mid-market SaaS" --type icp --icp-slug mid-market-saas
```

| Flag | Description |
|------|-------------|
| `--name <name>` *(required)* | Display name. |
| `--description <desc>` | Optional description. |
| `--type <type>` | `manual` (default), `smart`, `tagged`, `icp`. |
| `--query <json>` | Filter JSON. **Required for smart lists** (unless `--query-file`). |
| `--query-file <path>` | Path to JSON file with the query. |
| `--tag <tag>` | Tag this list pulls. Required for `tagged`. |
| `--icp-slug <slug>` | ICP this list derives from. Required for `icp`. |
| `--source <source>` | Override the source label (defaults to `claude` under token auth). |

#### `lists update <id>`
Patch a list's name, description, query (smart), or tag (tagged).

```bash
sendmaxx lists update lst_abc --name "Q2 hand-picked (rev 2)"
sendmaxx lists update lst_abc --query-file ./new-query.json
```

#### `lists delete <id>`
Delete a list. Claude tokens can only delete Claude-created lists.

```bash
sendmaxx lists delete lst_abc
```

#### `lists convert-to-manual <id>`
Materialize the current members of a smart/tagged/icp list and freeze it as manual. Useful when you want to snapshot a live list before launching a campaign.

```bash
sendmaxx lists convert-to-manual lst_abc
```

#### `lists add <listId>`
Add contacts to a manual list.

```bash
sendmaxx lists add lst_abc --contacts "ct_1,ct_2,ct_3"
```

#### `lists remove <listId>`
Remove contacts from a manual list.

```bash
sendmaxx lists remove lst_abc --contacts "ct_1,ct_2"
```

---

### `tags`

Inspect contact tags across the whole CRM.

#### `tags list`
List every tag in use, with usage counts broken down by source (`claude` vs `user`).

```bash
sendmaxx tags list --pretty
```

---

### `icps`

Manage ideal customer profiles. Also available as `icp` (singular).

#### `icps list`
List ICPs. Supports pagination.

```bash
sendmaxx icps list --pretty
```

#### `icps get <slug>`
Get an ICP's full details, including its markdown body.

```bash
sendmaxx icps get mid-market-saas
```

#### `icps create`
Create an ICP. By default, an ICP-derived list is auto-spawned alongside it — pass `--no-list` to skip.

```bash
sendmaxx icps create --name "Mid-market SaaS" --content-file ./icp.md
sendmaxx icps create --name "Tier 2" --slug tier-2 --parent-icp-id icp_abc --no-list
```

| Flag | Description |
|------|-------------|
| `--name <name>` *(required)* | Display name. |
| `--slug <slug>` | URL slug (defaults to slugified name). |
| `--description <desc>` | Short description. |
| `--content <markdown>` | ICP body as a string. |
| `--content-file <path>` | Path to a markdown file with the ICP body. |
| `--parent-icp-id <id>` | Parent ICP ID, for sub-ICPs. |
| `--no-list` | Skip auto-spawning the ICP-derived list. |

#### `icps update <slug>`
Update an ICP's fields.

```bash
sendmaxx icps update mid-market-saas --content-file ./icp-v2.md
sendmaxx icps update mid-market-saas --description "Updated 2026 Q2"
```

#### `icps archive <slug>`
Soft-delete (status → `archived`). Data is retained.

```bash
sendmaxx icps archive mid-market-saas
```

#### `icps restore <slug>`
Restore an archived ICP.

```bash
sendmaxx icps restore mid-market-saas
```

#### `icps delete <slug>`
Hard-delete an ICP **and its derived list**. Cannot be undone.

```bash
sendmaxx icps delete mid-market-saas
```

---

### `pipeline`

View pipeline state across all campaigns.

#### `pipeline status`
Aggregate counts per stage across the whole pipeline.

```bash
sendmaxx pipeline status --pretty
```

#### `pipeline contacts`
List the contacts currently in the pipeline. Supports pagination and stage filtering.

```bash
sendmaxx pipeline contacts --pretty
sendmaxx pipeline contacts --stage replied --limit 100
```

#### `pipeline export`
Dump the whole pipeline. Use `--format csv` for spreadsheet-friendly output.

```bash
sendmaxx pipeline export --format json  > pipeline.json
sendmaxx pipeline export --format csv   > pipeline.csv
```

---

### `replies`

Manage inbound replies.

#### `replies list`
List replies. Supports pagination and tag filtering.

```bash
sendmaxx replies list --pretty
sendmaxx replies list --tag interested --limit 100
```

Tags: `interested`, `meeting_booked`, `not_now`, `unsubscribed`, `unknown`.

#### `replies tag <id>`
Set a reply's tag.

```bash
sendmaxx replies tag rep_abc --tag meeting_booked
```

#### `replies sync`
Trigger a Gmail sync for new replies. Prints the count of newly synced messages.

```bash
sendmaxx replies sync
```

---

### `alerts`

Top-level command (no subcommand). Prints a roll-up of pending action items: untagged replies, stale contacts, etc.

```bash
sendmaxx alerts --pretty
```

### `stale`

Top-level command. Lists contacts that need re-enrichment (no `enrichedAt`, or `enrichedAt` older than the threshold).

```bash
sendmaxx stale --pretty
sendmaxx stale --days 30        # tighten the threshold
```

---

## Examples

**Build a filtered list and save it for a campaign:**

```bash
sendmaxx contacts search \
  --title "VP Engineering" \
  --state CA \
  --min-confidence 7 \
  --save-as "CA VP Eng — high confidence"
```

**Triage replies after a campaign send:**

```bash
sendmaxx replies sync
sendmaxx replies list --tag unknown --pretty
```

**Re-enrich stale contacts:**

```bash
sendmaxx stale --days 90 | jq -r '.[].id' > stale-ids.txt
# ...feed into your enrichment pipeline...
```

**One-off against a staging instance, without touching local config:**

```bash
sendmaxx --url https://staging.sendmaxx.example --token sk_staging_xxx \
  campaigns list --pretty
```

**Pretty output of paginated results:**

```bash
sendmaxx contacts search --query acme --limit 25 --pretty
# (pagination footer goes to stderr)
```

---

## Exit codes

- `0` — success.
- `1` — failure (auth missing, API error, validation error, or — for `contacts add` with an array — at least one row failed).

Errors are written to stderr; structured data still goes to stdout. This makes it safe to `2>/dev/null` if you only care about the data, or `>/dev/null` if you only care about status.
