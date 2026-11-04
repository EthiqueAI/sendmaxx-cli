# SendMaxx CLI

`sendmaxx` is the command-line interface for [SendMaxx](https://github.com/EthiqueAI). It talks to your SendMaxx instance over the same REST API the web app uses, and is designed to be driven both by humans at a terminal and by AI agents (Claude Code, Claude Desktop) over MCP-style scripting.

By default every command emits JSON on stdout — easy to pipe through `jq`, parse from a script, or feed back into another tool. Pass `--pretty` for a human-readable table or summary.

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Global options](#global-options)
- [Output format](#output-format)
- [Pagination](#pagination)
- [Configuration](#configuration)
- [Archive vs. delete](#archive-vs-delete)
- [Commands](#commands)
  - [`auth`](#auth) — login, status, logout
  - [`contacts`](#contacts) — search, get, add, import, update, tag, archive, delete
  - [`campaigns`](#campaigns) — create, audience, launch/pause/resume, recipients, archive
  - [`emails`](#emails) — draft, reply, override, send one-off personal emails
  - [`lists`](#lists) — manual, smart, tagged, icp lists
  - [`tags`](#tags) — inspect tags across contacts
  - [`icps`](#icps) — ideal customer profiles
  - [`pipeline`](#pipeline) — pipeline status & export
  - [`replies`](#replies) — list, tag, sync
  - [`alerts`](#alerts) / [`stale`](#stale) — action items
- [Campaign step schema](#campaign-step-schema)
- [Stage hierarchy](#stage-hierarchy)
- [Examples](#examples)
- [Exit codes](#exit-codes)

---

## Install

### Option A — from the registry (recommended for end users)

The package is published to npm as `@ethiqueai/sendmaxx-cli`. No registry configuration needed:

```bash
npm install -g @ethiqueai/sendmaxx-cli
sendmaxx --version
```

It's also mirrored to GitHub Packages. To install from there instead, point the scope at GitHub (requires a GitHub token with `read:packages`):

```bash
npm config set @ethiqueai:registry https://npm.pkg.github.com
npm install -g @ethiqueai/sendmaxx-cli
```

### Option B — from source (for CLI development)

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
# 1. Authenticate against your SendMaxx instance. Prompts for an API token
#    (create one in Settings); input is hidden. --url is a root-level flag.
sendmaxx --url http://localhost:3000 auth login

# 2. Confirm.
sendmaxx auth status

# 3. Read something.
sendmaxx contacts search --query "acme" --pretty
sendmaxx campaigns list --pretty
sendmaxx pipeline status --pretty
```

---

## Global options

These flags work on any command and must appear **before** the subcommand:

| Flag | Description |
|------|-------------|
| `--token <token>` | API token. Overrides whatever is stored in config. |
| `--url <url>` | Base URL of the SendMaxx instance. Overrides config. |
| `--pretty` | Render output as a formatted table / summary instead of JSON. |
| `--help` | Show help for the current command. |
| `--version` | Print CLI version. |

Use `--token` / `--url` for one-off invocations (e.g. CI scripts that target a staging instance) without touching your local config.

---

## Output format

- **Default:** structured JSON on stdout. Ideal for `jq`, scripting, and agents.
- **`--pretty`:** human-readable table (lists) or rich summary (campaign detail). Pagination footers print to **stderr** so they don't pollute piped output.
- **Status messages** (e.g. `✓ Archived ct_abc`) also go to stderr.
- **Errors** are written to stderr; the process exits non-zero.

This makes it safe to `2>/dev/null` if you only care about the data, or `>/dev/null` if you only care about status.

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

Without `--limit`, the server returns its legacy non-paginated shape. With `--limit`, JSON output includes `total`, `limit`, `offset`, and `hasMore` fields; `--pretty` output adds a footer like `Showing 1–50 of 213 · more available (offset 50)` on stderr.

```bash
sendmaxx contacts search --limit 100
sendmaxx contacts search --limit 100 --offset 100
```

---

## Configuration

Credentials and base URL are stored at `~/.sendmaxx/config.json`:

```json
{
  "token": "sm_...",
  "baseUrl": "http://localhost:3000"
}
```

The file is written by `sendmaxx auth login` and removed by `sendmaxx auth logout`. It's created owner-only (`0600`) since it holds your token. You can edit it by hand if you need to.

`auth login` validates the token by hitting `GET /api/settings` before saving — a bad token, unreachable host, or wrong port fails fast rather than getting written.

---

## Archive vs. delete

SendMaxx contacts, lists, campaigns, and ICPs all support **archiving** — a reversible soft-hide. Archive is the default way to deal with anything no longer in active use. **Delete is the rare, explicit, nuclear option.**

| Operation | When to use it |
|---|---|
| `archive` | "Done with this for now." Default. Restorable. Hides from default views. Scheduler skips archived contacts and campaigns. Smart lists exclude archived contacts transparently. |
| `delete` | A typo-and-it's-gone operation. Cascades to enrollments, sent emails, click events, replies. Cannot be undone. |

Every destructive `delete` command requires `--yes` so a typo can't trigger it. Prefer `archive` 99% of the time — archived rows retain their full history (analytics, replies, click events) while deleted ones don't.

To see archived items, pass `--include-archived` (mix with active) or `--archived-only` (just archived) on any `list` / `search` command:

```bash
sendmaxx contacts search --archived-only
sendmaxx lists list --include-archived
sendmaxx campaigns list --archived-only
sendmaxx icps list --include-archived
```

---

## Commands

### `auth`

Manage CLI authentication.

#### `auth login`
Prompt for an API token, validate it against `/api/settings`, and save it with the base URL to `~/.sendmaxx/config.json`.

```bash
sendmaxx --url <url> auth login                         # prompts; input is hidden
sendmaxx --url <url> auth login --with-token < token.txt # non-interactive (scripts, CI)
```

`--url` defaults to `http://localhost:3000`. Without a terminal to prompt in and without `--with-token`, it exits with an error instead of hanging. The root `--token <token>` flag still works, but it leaves the token in your shell history, so prefer the prompt or `--with-token`. On success, prints `✓ Authenticated. Config saved to ~/.sendmaxx/config.json`.

#### `auth status`
Print current auth state (authenticated flag, base URL, masked token prefix).

```bash
sendmaxx auth status
```

#### `auth logout`
Clear stored credentials.

```bash
sendmaxx auth logout
```

---

### `contacts`

Manage contacts in the CRM.

#### `contacts search`
Search and filter contacts. Supports server-side pagination.

```bash
sendmaxx contacts search [filters] [--limit N --offset M]
```

| Flag | Description |
|------|-------------|
| `--query <text>` | Full-text search across name / email / company. |
| `--stage <stage>` | Pipeline stage (`new`, `sent`, `opened`, `replied`, `meeting_booked`, …). |
| `--state <state>` | US state. |
| `--county <county>` | County. |
| `--company <company>` | Company name. |
| `--title <title>` | Job title. |
| `--tag <tag>` | Contact tag (e.g. `event:saastr_2026`). |
| `--min-confidence <0-10>` | Only contacts with `confidenceScore >= N`. |
| `--include-archived` | Include archived contacts in results (default: active only). |
| `--archived-only` | Only return archived contacts. |
| `--save-as <name>` | Instead of returning results, save the current filter as a **smart list** with this name. |
| `--limit <n>` / `--offset <n>` | Pagination. |

#### `contacts get <id>`
Fetch a contact with full interaction history.

```bash
sendmaxx contacts get ct_abc
```

Returns the contact plus replies, sent emails, click events, and campaign enrollments — useful for call briefs.

#### `contacts add`
Add a single contact or a small batch in SendMaxx's canonical shape. Provide exactly one of `--json` or `--file`.

```bash
sendmaxx contacts add --json '{"email":"a@b.com","firstName":"Ada","company":"Acme"}'
sendmaxx contacts add --file ./enriched.json
```

The file can be a single object or an array. Array form loops one-by-one and reports `{ added, failed }` totals; the exit code is non-zero if any row failed. Duplicates (by email) are skipped server-side.

> Use `contacts add` only when data is already in canonical shape. For raw CSVs or large datasets, use **`contacts import`** below — it's a true bulk endpoint with one round-trip.

#### `contacts import`
Bulk import contacts from a CSV or JSON file. Single round-trip, deduped by email server-side.

```bash
sendmaxx contacts import --file leads.csv
sendmaxx contacts import --file leads.csv --dry-run
sendmaxx contacts import --file leads.csv --mapping '{"Lead Email":"email","Org":"company"}'
sendmaxx contacts import --file leads.json --format json
```

| Flag | Description |
|------|-------------|
| `--file <path>` *(required)* | Path to CSV or JSON file. |
| `--format <csv\|json>` | Auto-detected from the file extension if omitted. |
| `--mapping <json>` | Column-to-field mapping, either inline JSON or path to a JSON file. |
| `--dry-run` | Parse and validate the file but do not upload. Returns `{ parsed, importable, droppedNoEmail, preview }`. |

**Allowed fields (everything else is ignored):**

| Field | Required | Notes |
|---|---|---|
| `email` | yes | Lowercased server-side. Rows without a valid email are dropped. |
| `firstName` | | |
| `lastName` | | |
| `company` | | |
| `title` | | |
| `phone` | | |
| `state` | | US 2-letter code is conventional but not enforced. |
| `county` | | |
| `notes` | | Free text. |

**CSV format:**
- First row is the header. Cells may be quoted; embedded commas and `""`-escaped quotes are handled. UTF-8 BOM is stripped.
- Common header variants are auto-mapped: `Email Address`, `email_address`, `E-mail` → `email`; `First Name`, `first_name`, `Given Name`, `fname` → `firstName`; `Surname`, `Family Name` → `lastName`; `Job Title`, `Role`, `Position` → `title`; `Organization`, `Company Name`, `Org`, `Employer` → `company`; `Phone Number`, `Mobile`, `Tel` → `phone`; `Province`, `Region` → `state`; `Note`, `Comments` → `notes`.
- If a column doesn't auto-map, pass `--mapping '{"<exact header text>":"<canonical field>"}'`. The canonical field must be one of the nine fields above.

**JSON format:** either a top-level array `[{...}, {...}]` or `{"rows":[{...}, {...}]}`. Use canonical field names directly.

**Always run `--dry-run` first** on data you didn't generate yourself. It returns `{ parsed, importable, droppedNoEmail, preview }` so you can confirm the mapping is right before the real upload.

#### `contacts update <id>`
Patch fields on a contact.

```bash
sendmaxx contacts update ct_abc --json '{"title":"VP Engineering","phone":"+1..."}'
```

Manual user input is sacred. When re-enriching, only patch empty fields, or check with the user first.

#### `contacts update-stage <id>`
Move a contact through the pipeline.

```bash
sendmaxx contacts update-stage ct_abc --stage meeting_booked
```

Valid stages: `new`, `sent`, `opened`, `clicked`, `replied`, `meeting_booked`, `called`, `bounced`, `unsubscribed`. Stages only escalate; downgrade attempts are silently ignored. See [Stage hierarchy](#stage-hierarchy).

#### `contacts archive <id>`
Soft-hide a contact. Preferred over delete.

```bash
sendmaxx contacts archive ct_abc
```

Archived contacts:
- Hidden from `contacts search` and the UI contact pickers.
- **Excluded automatically from smart/tagged/ICP list resolution** — campaigns launched off those lists won't enroll them.
- **Skipped by the scheduler** — even existing enrollments stop receiving sends until the contact is restored.
- Still visible on `contacts get <id>` directly (so you can inspect / restore).
- Replies and call history are untouched.

If already archived, returns `alreadyArchived: true` and is a no-op.

#### `contacts restore <id>`
Un-archive a contact. Becomes visible again and the scheduler resumes any pending enrollments.

```bash
sendmaxx contacts restore ct_abc
```

#### `contacts delete <id>`
Hard-delete a contact. Cascades to enrollments, sent emails, click events, replies, bounce records. **Cannot be undone.** Requires `--yes`.

```bash
sendmaxx contacts delete ct_abc --yes
```

Prefer `contacts archive` unless you really mean to wipe everything.

#### `contacts bulk-delete`
Delete many contacts in one call. Cascades just like `delete`. Requires `--yes`.

```bash
sendmaxx contacts bulk-delete --ids ct_1,ct_2,ct_3 --yes
sendmaxx contacts bulk-delete --file ids.txt --yes      # one ID per line
```

Returns `{ deleted: <n> }`.

#### `contacts tag <id>`
Add one or more tags to a contact. Multiple tags can be comma-separated.

```bash
sendmaxx contacts tag ct_abc --tag event:saastr_2026
sendmaxx contacts tag ct_abc --tag "event:saastr_2026,priority" \
  --source claude --confidence 0.85 --reasoning "Title + LinkedIn match enterprise ICP"
```

| Flag | Description |
|------|-------------|
| `--tag <tags>` *(required)* | Single tag or comma-separated list. |
| `--source <user\|claude>` | Attribution. Defaults to `claude` when token-auth is in use. |
| `--confidence <0..1>` | Claude attribution confidence. |
| `--reasoning <text>` | Why this tag applies. |

#### `contacts untag <id>`
Remove one or more tags.

```bash
sendmaxx contacts untag ct_abc --tag event:saastr_2026
sendmaxx contacts untag ct_abc --tag "tag1,tag2"
```

#### `contacts tags <id>`
List tags currently on a contact (tag, source, confidence, timestamp).

```bash
sendmaxx contacts tags ct_abc --pretty
```

---

### `campaigns`

Manage outreach campaigns. A campaign is a sequence of steps (subject + body, optional A/B variant subject, delay days). Campaigns are created as drafts; you launch them explicitly.

#### `campaigns list`
List campaigns. Supports pagination and archive filtering.

```bash
sendmaxx campaigns list --pretty
sendmaxx campaigns list --archived-only
sendmaxx campaigns list --include-archived --limit 100
```

#### `campaigns get <id>`
Full details on a campaign — name, status, A/B flag, totals, all steps. `--pretty` renders a rich summary with per-step preview, A/B subjects, and a performance bar chart.

```bash
sendmaxx campaigns get cmp_abc --pretty
```

#### `campaigns create`
Create a campaign (always as draft). Steps are supplied as a JSON file matching the [campaign step schema](#campaign-step-schema).

```bash
sendmaxx campaigns create --name "Q2 Founders Outreach" --steps-file ./steps.json
sendmaxx campaigns create --name "Q2 A/B test" --steps-file ./steps.json --ab-test
```

| Flag | Description |
|------|-------------|
| `--name <name>` *(required)* | Campaign name. |
| `--steps-file <path>` | Path to a JSON file with the step list. |
| `--ab-test` | Enable A/B subject testing. |

You can skip `--steps-file` and add steps later with `campaigns update`.

#### `campaigns update <id>`
Edit a draft (or an active campaign — though already-sent emails are unaffected).

```bash
sendmaxx campaigns update cmp_abc --name "Q2 Founders v2"
sendmaxx campaigns update cmp_abc --steps-file ./steps-v2.json     # REPLACES all steps
sendmaxx campaigns update cmp_abc --ab-test
sendmaxx campaigns update cmp_abc --no-ab-test
```

| Flag | Description |
|------|-------------|
| `--name <name>` | New name. |
| `--ab-test` / `--no-ab-test` | Toggle A/B subject testing. |
| `--steps-file <path>` | Replace all steps. Server deletes existing steps and re-inserts. |

`--steps-file` is a full replace, not a patch. Already-sent emails reference the previous step content via stored copies, so they're unaffected.

#### `campaigns archive <id>`
Archive a campaign. Hidden from default views; restorable. Auto-pauses if currently `active` (response includes `autoPaused: true`).

```bash
sendmaxx campaigns archive cmp_abc
```

Archived campaigns:
- Scheduler skips them — no future sends.
- Analytics, sent emails, click events, and replies are preserved.
- Hidden from `campaigns list` by default.

#### `campaigns restore <id>`
Un-archive a campaign. Status stays `paused` after restore — call `campaigns resume` to start sending again.

```bash
sendmaxx campaigns restore cmp_abc
sendmaxx campaigns resume  cmp_abc
```

#### `campaigns delete <id>`
Hard-delete a campaign. Cascades to its steps, all enrollments, sent emails, click events, replies. **Cannot be undone.** Requires `--yes`.

```bash
sendmaxx campaigns delete cmp_abc --yes
```

Prefer `campaigns archive` — archived campaigns retain analytics, deleted ones don't.

#### `campaigns launch <id>`
Set status to `active` and enroll the audience for immediate send.

```bash
sendmaxx campaigns launch cmp_abc                           # uses existing audience
sendmaxx campaigns launch cmp_abc --contacts ct_1,ct_2,ct_3 # enroll these too
```

Returns `{ ok: true, enrolled: <n> }`. The server rejects launches with no steps or empty audience.

#### `campaigns pause <id>`
Stop the scheduler from picking up new sends for this campaign. Existing enrollments keep their state.

```bash
sendmaxx campaigns pause cmp_abc
```

#### `campaigns resume <id>`
Move back to `active` from `paused`.

```bash
sendmaxx campaigns resume cmp_abc
```

#### `campaigns audience show <id>`
List the current audience: per-contact rows plus a source-list summary.

```bash
sendmaxx campaigns audience show cmp_abc --pretty
```

JSON shape: `{ contacts: [...], lists: [...], individualCount, totalCount }`. Each contact row carries the `campaignContactId` (use this for `audience remove --cc-ids`).

#### `campaigns audience add <id>`
Add contacts to the audience. Provide `--contacts` and/or `--list`. List sources are snapshot at add-time — smart/tagged/icp lists are resolved now, the snapshot is frozen.

```bash
sendmaxx campaigns audience add cmp_abc --contacts ct_1,ct_2
sendmaxx campaigns audience add cmp_abc --list lst_xyz
sendmaxx campaigns audience add cmp_abc --contacts ct_3 --list lst_abc
```

Duplicates (same contact + same campaign) are silently no-op'd. Returns `{ added: <n> }`.

#### `campaigns audience remove <id>`
Remove enrollments. Provide `--cc-ids` (campaignContact IDs from `audience show`) and/or `--list` (removes everything sourced from that list).

```bash
sendmaxx campaigns audience remove cmp_abc --cc-ids cc_1,cc_2
sendmaxx campaigns audience remove cmp_abc --list lst_abc
```

Note: `--cc-ids` are **campaignContact** IDs, not contact IDs. Removing the source list itself (`lists delete lst_abc`) does **not** disenroll contacts — the audience is a snapshot.

#### `campaigns recipients <id>`
Read-only per-recipient engagement: sends, opens, clicks, replies, current step. Useful for triage — "who opened but didn't reply?".

```bash
sendmaxx campaigns recipients cmp_abc --pretty
```

Each row includes `emailsSent`, `opens`, `firstOpenAt`, `clicks`, `clickDetails`, `replied`, `openHistory`, `currentStep`, `status`.

#### `campaigns recipient-stage <ccId>`
Update the free-form `stage` label on a single enrollment (independent of the contact's overall stage).

```bash
sendmaxx campaigns recipient-stage cc_abc --stage "demo scheduled"
```

#### `campaigns performance <id>`
Per-step and per-variant analytics aggregated across the campaign. Includes the `abVariants` field when A/B testing is enabled.

```bash
sendmaxx campaigns performance cmp_abc
```

---

### `emails`

Individually-written emails to one person — as opposed to `campaigns`, which send one
template to many. Three kinds share the resource: a standalone note, a reply into an
existing Gmail thread, and a per-recipient override that replaces a campaign step's
body for one enrolled contact.

Also registered as `sendmaxx email` (singular).

#### `emails list`

```bash
sendmaxx emails list --status draft --pretty
sendmaxx emails list --kind reply --contact ct_abc
```

| Flag | Description |
|---|---|
| `--status <s>` | `draft`, `approved`, `sending`, `sent`, `canceled`, `failed` |
| `--kind <k>` | `standalone`, `reply`, `campaign_override` |
| `--contact <id>` | Only emails to this contact |
| `--include-archived` | Include archived emails |
| `--archived-only` | Only archived emails |
| `--limit`, `--offset` | Pagination |

#### `emails get <id>`

`--pretty` renders the subject, recipient, body, and the personalization note behind it.

#### `emails draft`

```bash
sendmaxx emails draft --contact ct_abc --subject "The auditor portal walkthrough" \
  --content "$(cat <<'EOF'
Hey Sarah,

You asked twice yesterday how auditors get in without a full seat — here's the
2-minute version.
EOF
)" --why "Raised auditor access twice on the 8/31 call"
```

| Flag | Description |
|---|---|
| `--contact <id>` | **Required.** Contact id |
| `--subject <s>` | **Required.** Sent literally — no merge fields |
| `--content <md>` | Body as markdown. Prefer this with a heredoc |
| `--content-file <path>` | Body from a file. Wins over `--content` when both are passed |
| `--why <text>` | Why this email says what it says; shown in review |
| `--sources <a,b>` | Sources behind the personalization |
| `--at <iso>` | Schedule for a specific time |
| `--no-tracking` | Send without the tracking pixel and link rewriting |

Merge fields (`{{first_name}}` etc.) still substitute, but in a personal email they
are a tell that it isn't personal. Write the actual name.

#### `emails reply`

```bash
sendmaxx emails reply --contact ct_abc --thread 18f2c9d4e5a6b7c8 --content "..."
```

Reads the subject and RFC822 threading headers from the thread so the reply lands in
the conversation rather than starting a new one. Takes the same content, `--why`,
`--at` and `--no-tracking` flags as `draft`, plus `--thread <gmailThreadId>`
(required) and an optional `--subject` override. Requires a connected Gmail account.

#### `emails override`

```bash
sendmaxx campaigns recipients cmp_abc          # get campaignContact ids
sendmaxx emails override --campaign-contact cc_xyz --step 0 --content "..."
```

Replaces the shared step body with bespoke text for one recipient. The campaign still
delivers it, on its own schedule. `--subject` is optional; without it the step's
subject is used. One override per recipient per step.

Approving is the whole action — there's nothing to send yourself. An override still in
`draft` when its step comes due is skipped: the template sends and the override is
marked `canceled`.

#### `emails update <id>`

Takes `--subject`, `--content` / `--content-file`, `--why`, `--at`, and
`--tracking` / `--no-tracking`. Editing an approved email returns it to `draft` — the
approval was for the text that was reviewed.

#### `emails send <id>`

```bash
sendmaxx emails send pe_9kQ --yes           # queue it for the scheduler
sendmaxx emails send pe_9kQ --yes --now     # send immediately
```

| Flag | Description |
|---|---|
| `--yes` | **Required.** Confirms you are releasing this email to a real person |
| `--now` | Send immediately instead of waiting for the next scheduler tick |

Without `--now` the email becomes due work the scheduler picks up, inheriting the send
window, daily cap and 1/sec throttle. `--now` bypasses only the send-hour window — the
daily cap and throttle still apply.

Sending is refused if the contact is `unsubscribed` or `bounced`; the email is marked
`canceled` with a reason.

#### `emails cancel <id>` / `archive` / `restore` / `delete`

`cancel` stops an email from ever sending. `archive` is the reversible cleanup verb;
`delete --yes` is permanent.

---

### `lists`

Lists group contacts for targeting. Four kinds:

- **`manual`** — explicit set of contacts you add/remove.
- **`smart`** — driven by a saved query; membership recomputes on read.
- **`tagged`** — auto-includes contacts carrying a specific tag.
- **`icp`** — auto-spawned from an ICP doc; tracks contacts matched against it.

#### `lists list`
List all lists. Supports pagination and archive filtering.

```bash
sendmaxx lists list --pretty
sendmaxx lists list --archived-only
sendmaxx lists list --include-archived --limit 100
```

#### `lists get <id>`
Get list details including current members.

```bash
sendmaxx lists get lst_abc
```

#### `lists create`
Create a list of any type. Required flags depend on type:

```bash
# Manual (default)
sendmaxx lists create --name "Q2 hand-picked"

# Smart — query inline or from file
sendmaxx lists create --name "Enterprise VPs" --type smart \
  --query '{"title":["VP Engineering","CTO"],"state":["CA","NY"]}'
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
| `--query <json>` | Filter JSON. Required for `smart` (unless `--query-file`). Validated locally before send. |
| `--query-file <path>` | Path to JSON file with the query (for `smart`). |
| `--tag <tag>` | Tag this list pulls. Required for `tagged`. |
| `--icp-slug <slug>` | ICP this list derives from. Required for `icp`. |
| `--source <source>` | Override source label (defaults to `claude` under token-auth). |

#### `lists update <id>`
Patch a list's name, description, query (smart), or tag (tagged).

```bash
sendmaxx lists update lst_abc --name "Q2 hand-picked (rev 2)"
sendmaxx lists update lst_abc --query-file ./new-query.json
sendmaxx lists update lst_abc --tag event:saastr_2026_speakers   # tagged lists only
```

#### `lists convert-to-manual <id>`
Materialize current members of a smart/tagged/icp list and freeze it as `manual`. Useful when you want to snapshot a live list before launching a campaign.

```bash
sendmaxx lists convert-to-manual lst_abc
```

#### `lists add <listId>`
Add contacts to a `manual` list.

```bash
sendmaxx lists add lst_abc --contacts ct_1,ct_2,ct_3
```

#### `lists remove <listId>`
Remove contacts from a `manual` list.

```bash
sendmaxx lists remove lst_abc --contacts ct_1,ct_2
```

Only `manual` lists accept direct add/remove. For smart/tagged/icp, change the query/tag/ICP instead.

#### `lists archive <id>`
Soft-hide a list.

```bash
sendmaxx lists archive lst_abc
```

Archived lists:
- Hidden from `lists list` by default.
- **Campaigns that already snapshotted from this list are unaffected** — audience is frozen at add-time.
- Smart/tagged/ICP lists can be archived too; the underlying query is preserved for when you restore.

#### `lists restore <id>`
Un-archive.

```bash
sendmaxx lists restore lst_abc
```

#### `lists delete <id>`
Hard-delete a list. Cascades to memberships. **Cannot be undone.** Requires `--yes`. Claude tokens may only delete Claude-created lists.

```bash
sendmaxx lists delete lst_abc --yes
```

---

### `tags`

#### `tags list`
List every tag in use across the CRM, with totals and a per-source breakdown (`claude` vs `user`).

```bash
sendmaxx tags list --pretty
```

---

### `icps`

Manage ideal customer profiles. Also available as `icp` (singular alias).

ICPs are server-first: `sendmaxx icps get <slug>` is the source of truth. Any local markdown file is a draft, not authoritative. Once an ICP exists, an auto-spawned list of `type: icp` becomes the execution vehicle — discovery adds prospects to it, campaigns target it.

#### `icps list`
List ICPs. Supports pagination and archive filtering.

```bash
sendmaxx icps list --pretty
sendmaxx icps list --archived-only
sendmaxx icps list --include-archived
```

#### `icps get <slug>`
Get ICP details, including the markdown body.

```bash
sendmaxx icps get vertical-saas
```

#### `icps create`
Create an ICP. By default, auto-spawns an ICP-derived list named `ICP: <name>` — pass `--no-list` to skip.

```bash
# Inline content via heredoc — preferred for short ICPs.
sendmaxx icps create --name "Vertical SaaS founders" --slug vertical-saas --content "$(cat <<'EOF'
# Vertical SaaS founders

Companies building software for a single industry vertical...
EOF
)"

# From a markdown file
sendmaxx icps create --name "Mid-market SaaS" --content-file ./icp.md

# Sub-ICP, no list
sendmaxx icps create --name "Tier 2 banks" --slug tier-2-banks \
  --parent-icp-id icp_fintech --no-list
```

| Flag | Description |
|------|-------------|
| `--name <name>` *(required)* | Display name. |
| `--slug <slug>` | URL slug (defaults to slugified name). |
| `--description <desc>` | Short description. |
| `--content <markdown>` | ICP body as a string. **Prefer this with a heredoc** over `--content-file` for short docs. |
| `--content-file <path>` | Path to a markdown file with the ICP body. |
| `--parent-icp-id <id>` | Parent ICP ID, for sub-ICPs. |
| `--no-list` | Skip auto-spawning the ICP-derived list. |

#### `icps update <slug>`
Update an ICP's fields.

```bash
sendmaxx icps update vertical-saas --content-file ./icp-v2.md
sendmaxx icps update vertical-saas --description "Refreshed for Q2 2026"
sendmaxx icps update vertical-saas --parent-icp-id icp_parent
sendmaxx icps update vertical-saas --parent-icp-id ""        # unparent
```

#### `icps archive <slug>`
Archive an ICP. By default also cascade-archives its auto-spawned list.

```bash
sendmaxx icps archive vertical-saas
sendmaxx icps archive vertical-saas --keep-list   # archive only the ICP doc
```

Restore is symmetric: restoring an ICP also un-archives its linked list if archived alongside.

#### `icps restore <slug>`
Restore an archived ICP. Also restores its linked list if it was archived alongside.

```bash
sendmaxx icps restore vertical-saas
```

#### `icps delete <slug>`
Hard-delete an ICP **and its derived list**. **Cannot be undone.** Requires `--yes`.

```bash
sendmaxx icps delete vertical-saas --yes
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
sendmaxx pipeline export --format json > pipeline.json
sendmaxx pipeline export --format csv  > pipeline.csv
```

---

### `replies`

Manage inbound replies. SendMaxx polls Gmail every 5 minutes automatically and auto-tags new replies from keywords; the commands below are for triage and manual sync.

#### `replies list`
List replies. Supports pagination and tag filtering.

```bash
sendmaxx replies list --pretty
sendmaxx replies list --tag unknown --limit 100
```

Valid tags: `interested`, `meeting_booked`, `not_now`, `unsubscribed`, `unknown`.

#### `replies tag <id>`
Set a reply's tag.

```bash
sendmaxx replies tag rep_abc --tag meeting_booked
```

Tagging as `meeting_booked` or `unsubscribed` also escalates the contact's overall stage.

#### `replies sync`
Force an immediate Gmail sync. The background poller runs every 5 minutes regardless — only call this when the user explicitly asks for an immediate refresh. Prints `{ newReplies: <n> }`.

```bash
sendmaxx replies sync
```

---

### `alerts`

Top-level command (no subcommand). Prints a roll-up of pending action items: untagged replies, stale contacts (90+ days).

```bash
sendmaxx alerts --pretty
```

---

### `stale`

Top-level command. Lists contacts that need re-enrichment (missing `enrichedAt`, or `enrichedAt` older than the threshold).

```bash
sendmaxx stale --pretty
sendmaxx stale --days 30        # tighten the threshold (default: 90 days)
```

---

## Campaign step schema

A campaign's `steps.json` is a JSON array. Each step:

```json
[
  {
    "subjectA": "Quick question about your outbound stack",
    "subjectB": "30 seconds?",
    "bodyHtml": "<p>Hey {{first_name}}, saw {{company}} is hiring SDRs — …</p>",
    "bodyText": "Hey {{first_name}}, saw {{company}} is hiring SDRs — …",
    "delayDays": 0
  },
  {
    "subjectA": "Re: Quick question",
    "bodyHtml": "<p>Following up…</p>",
    "delayDays": 3
  }
]
```

Field by field:

| Field | Required | Behavior |
|---|---|---|
| `subjectA` | yes | Subject line. **No merge fields** — subjects are sent literally. |
| `subjectB` | no | A/B variant subject (used only when the campaign has `abTestEnabled`). Falls back to `subjectA` if absent. |
| `bodyHtml` | yes | Markdown allowed — rendered through `marked()` at send time. Merge fields substituted first. |
| `bodyText` | no | Plain-text alternative. Same merge-field rules. |
| `delayDays` | no, default `0` | Days to wait after the previous step. Step 0 fires immediately on launch. |

**Merge fields (case-insensitive, BODY ONLY):**

| Token | Resolves to | Fallback |
|---|---|---|
| `{{first_name}}` | `contact.firstName` | `there` |
| `{{last_name}}` | `contact.lastName` | empty |
| `{{name}}` | first + last | first only |
| `{{company}}` | `contact.company` | `your company` |
| `{{title}}` | `contact.title` | empty |

If you put a merge field in a subject, it'll be sent as-is (e.g. `Hi {{first_name}}` in the inbox). Don't do that.

**Other send-time behaviors handled automatically:**
- Tracking pixel injected into HTML body (counts after 5s to filter scanner pre-fetch).
- Links rewritten through tracked redirects.
- Email signature appended.
- Per-user daily cap (default 100/day, max 1000) and send window (default 8am–6pm in user's timezone).
- 1 email/sec per user (Gmail rate limit).
- Bounced and replied contacts are skipped on all future steps.

---

## Stage hierarchy

Contact stages only escalate; downgrade attempts are silently ignored server-side.

```
new → sent → opened → clicked → replied → meeting_booked
                                       ↘
                                        called
```

Terminal: `bounced`, `unsubscribed` (also stop all future sends).

Stage escalations happen automatically:
- Send → `sent`
- Open → `opened`
- Click → `clicked`
- Reply detected → `replied` (or `unsubscribed` for opt-out keywords)
- Reply tagged `meeting_booked` → `meeting_booked`
- Bounce → `bounced`

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

**Bulk import a CSV with a custom mapping:**

```bash
# Inspect first.
sendmaxx contacts import --file leads.csv --dry-run

# If the email column header isn't auto-recognized, map it explicitly.
sendmaxx contacts import --file leads.csv \
  --mapping '{"Primary Email":"email","Org":"company"}'
```

**Create, populate, and launch a campaign:**

```bash
# 1. Draft
sendmaxx campaigns create --name "Q2 Founders" --steps-file ./steps.json
# → captures cmp_abc from the response

# 2. Audience
sendmaxx campaigns audience add cmp_abc --list lst_high_fit
sendmaxx campaigns audience show cmp_abc --pretty   # confirm

# 3. Launch (only after explicit user approval)
sendmaxx campaigns launch cmp_abc

# 4. Watch
sendmaxx campaigns performance cmp_abc
sendmaxx campaigns recipients  cmp_abc --pretty
```

**Triage replies after a send:**

```bash
sendmaxx replies sync                           # optional immediate refresh
sendmaxx replies list --tag unknown --pretty
sendmaxx replies tag rep_abc --tag meeting_booked
```

**Tidy up — archive, not delete:**

```bash
sendmaxx contacts archive ct_abc           # default cleanup verb
sendmaxx contacts restore ct_abc           # undo
sendmaxx contacts search --archived-only   # find what you archived

# Only when the user explicitly says "delete" / "wipe":
sendmaxx contacts delete ct_abc --yes
sendmaxx contacts bulk-delete --file ids.txt --yes
```

**Create an ICP and let the auto-spawned list become the execution vehicle:**

```bash
sendmaxx icps create --name "Vertical SaaS founders" --slug vertical-saas --content "$(cat <<'EOF'
# Vertical SaaS founders

Companies building software for a single industry vertical, with $1M–$20M ARR,
20–200 employees, hiring SDRs in the past 90 days.
EOF
)"

# The auto-spawned list has type "icp" and icpSlug "vertical-saas":
sendmaxx lists list | jq '.lists[] | select(.type == "icp" and .icpSlug == "vertical-saas")'
```

**Re-enrich stale contacts:**

```bash
sendmaxx stale --days 90 | jq -r '.[].id' > stale-ids.txt
# … feed into your enrichment pipeline …
# Then patch only empty fields:
sendmaxx contacts update ct_abc --json '{"phone":"+1..."}'
```

**One-off against a staging instance, without touching local config:**

```bash
sendmaxx --url https://staging.sendmaxx.example --token sm_staging_xxx \
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

Errors are written to stderr; structured data still goes to stdout. Safe to redirect either stream independently.
