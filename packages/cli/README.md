# @llmintel/cli

Fail your CI build when it references **retired or soon-to-be-retired AI models**.

`llmintel check` scans your code/config for referenced model ids (and/or takes explicit ids),
looks up their lifecycle state via the [LLMIntel API](https://llmintel.vercel.app/docs), and exits
non-zero when any referenced model is **retired or past its retirement date** — so you migrate on
your schedule, not the provider's shutoff date.

## Install

No install required — run it with `npx`:

```bash
npx @llmintel/cli@latest check src config
```

Or add it as a dev dependency:

```bash
npm install --save-dev @llmintel/cli
```

## Authenticate

Create an API key from your [dashboard](https://llmintel.vercel.app/dashboard) and expose it as an
environment variable:

```bash
export LLMINTEL_API_KEY="mc_live_..."
```

## Usage

```bash
# Scan files/directories for referenced model ids and gate on lifecycle state:
llmintel check src config

# Check explicit ids/aliases without scanning:
llmintel check --models "gpt-4o,claude-3-opus-20240229"

# Use a config file:
llmintel check --config llmintel.json
```

### Options

| Flag                  | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `-m, --models <a,b,c>` | Explicit model ids/aliases to check (repeatable)                       |
| `-c, --config <file>`  | JSON config: `{ "models": [...], "paths": [...], "warnDays": 90 }`     |
| `--api-url <url>`      | API base URL (env `LLMINTEL_API_URL`, default `https://llmintel.vercel.app`) |
| `--api-key <key>`      | API key (env `LLMINTEL_API_KEY`)                                     |
| `--warn-days <n>`      | Warn when a model retires within this many days (default `90`)         |
| `--fail-on-warn`       | Treat warnings (deprecated / retiring soon) as build failures          |
| `--fail-on-unknown`    | Treat references LLMIntel does not track as build failures           |
| `--no-policy`          | Ignore your account's central policy; use only the flags above         |
| `--optimize`           | Also print advisory cheaper/faster model suggestions (paid; never fails the build) |
| `--json`               | Machine-readable JSON output                                           |
| `-q, --quiet`          | Only print failures                                                    |

## Central gate policy

By default `check` fails only on **retired** (or past-due) models — free forever. On a paid plan
you can configure a stricter policy **once** in your [dashboard](https://llmintel.vercel.app/dashboard)
and every pipeline picks it up automatically: fail on `deprecated`/`retiring`, set the warn
window, and fail on untracked references.

`check` fetches this policy on each run and uses it as the baseline. Explicit local flags
(`--warn-days`, `--fail-on-unknown`) override it; pass `--no-policy` to ignore it entirely. Free
accounts are always clamped to the retired-only gate regardless of any saved policy.

## Auto-watch your codebase (`sync`)

`llmintel sync` discovers the models your code references — the same scan as `check` — and
registers them as your account's **watched set** server-side. Combined with push alerts
(webhook / Slack / PagerDuty), this gives you "fire and forget" coverage: run `sync` in CI on
merge to `main`, and you'll be notified the moment a model you actually use is deprecated or
retired, with no watchlist to curate by hand.

```bash
# Replace your watched set with whatever your code references now:
llmintel sync src config

# Preview the diff without writing anything:
llmintel sync src config --dry-run

# Only add models; never remove ones you watch elsewhere:
llmintel sync src config --no-prune
```

`sync` requires a paid plan with auto-watch enabled and an API key linked to an account. It prints
the diff of `added` / `removed` / `unchanged` watches plus any `unresolved` references.

### Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| `0`  | All referenced models healthy                                 |
| `1`  | One or more errors (retired / past due), or warnings with `--fail-on-warn` |
| `2`  | Usage / configuration error                                   |
| `3`  | API or network error                                          |

## GitHub Actions

A composite action ships alongside the CLI:

```yaml
- uses: hivemindunit/llmintel-cli/packages/cli@main
  with:
    api-key: ${{ secrets.LLMINTEL_API_KEY }}
    paths: "src config"
    warn-days: "90"
```

## License

MIT
