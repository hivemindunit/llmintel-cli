export interface CliOptions {
  command: "check" | "sync" | "help" | "version";
  /** Explicit model strings passed via --models a,b,c (repeatable). */
  models: string[];
  /** File/dir paths to scan (positional args). */
  paths: string[];
  /** Optional JSON config file path. */
  config: string | null;
  apiUrl: string;
  apiKey: string | null;
  warnDays: number;
  failOnWarn: boolean;
  failOnUnknown: boolean;
  json: boolean;
  quiet: boolean;
  /** sync: print the diff without writing. */
  dryRun: boolean;
  /** sync: remove watches no longer referenced (default true). */
  prune: boolean;
  /** check: fetch and apply the account's central gate policy (default true). */
  usePolicy: boolean;
  /** check: also fetch + print advisory cost/perf optimization suggestions (never affects exit code). */
  optimize: boolean;
  /** Which gate flags the user set explicitly, so a remote policy doesn't clobber overrides. */
  explicit: { warnDays: boolean; failOnWarn: boolean; failOnUnknown: boolean };
}

export const DEFAULT_API_URL = "https://llmintel.vercel.app";
export const DEFAULT_WARN_DAYS = 90;

export class UsageError extends Error {}

function parseModelsList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse argv (without the leading `node script` entries). Env supplies API defaults. */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const options: CliOptions = {
    command: "help",
    models: [],
    paths: [],
    config: null,
    apiUrl: env.LLMINTEL_API_URL ?? DEFAULT_API_URL,
    apiKey: env.LLMINTEL_API_KEY ?? null,
    warnDays: DEFAULT_WARN_DAYS,
    failOnWarn: false,
    failOnUnknown: false,
    json: false,
    quiet: false,
    dryRun: false,
    prune: true,
    usePolicy: true,
    optimize: false,
    explicit: { warnDays: false, failOnWarn: false, failOnUnknown: false },
  };

  const positional: string[] = [];
  let i = 0;

  const first = argv[0];
  if (first === "check" || first === "sync" || first === "help" || first === "version") {
    options.command = first;
    i = 1;
  } else if (first === "--version" || first === "-v") {
    options.command = "version";
    return options;
  } else if (first === "--help" || first === "-h" || first === undefined) {
    options.command = "help";
    return options;
  } else {
    // Default to `check` so `llmintel src/` works without the subcommand.
    options.command = "check";
  }

  const need = (flag: string, value: string | undefined): string => {
    if (value === undefined) throw new UsageError(`Missing value for ${flag}`);
    return value;
  };

  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    switch (arg) {
      case "--models":
      case "-m":
        options.models.push(...parseModelsList(need(arg, argv[++i])));
        break;
      case "--config":
      case "-c":
        options.config = need(arg, argv[++i]);
        break;
      case "--api-url":
        options.apiUrl = need(arg, argv[++i]);
        break;
      case "--api-key":
        options.apiKey = need(arg, argv[++i]);
        break;
      case "--warn-days": {
        const raw = need(arg, argv[++i]);
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) throw new UsageError(`--warn-days must be a non-negative number, got "${raw}"`);
        options.warnDays = Math.floor(n);
        options.explicit.warnDays = true;
        break;
      }
      case "--fail-on-warn":
        options.failOnWarn = true;
        options.explicit.failOnWarn = true;
        break;
      case "--fail-on-unknown":
        options.failOnUnknown = true;
        options.explicit.failOnUnknown = true;
        break;
      case "--no-policy":
        options.usePolicy = false;
        break;
      case "--optimize":
        options.optimize = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--prune":
        options.prune = true;
        break;
      case "--no-prune":
        options.prune = false;
        break;
      case "--json":
        options.json = true;
        break;
      case "--quiet":
      case "-q":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        options.command = "help";
        return options;
      default:
        if (arg.startsWith("-")) throw new UsageError(`Unknown flag: ${arg}`);
        positional.push(arg);
    }
  }

  options.paths = positional;
  return options;
}

export const HELP_TEXT = `llmintel — gate and track AI model lifecycle state in CI/CD

Usage:
  llmintel check [paths...] [options]   Fail the build on retired/at-risk models
  llmintel sync  [paths...] [options]   Auto-watch the models your code uses (paid)

check
  Scans the given files/directories (and/or --models) for referenced AI model ids,
  looks up their lifecycle state via the LLMIntel API, and exits non-zero when any
  referenced model is retired (or past due). Deprecated/retiring models, or models
  retiring within --warn-days, are reported as warnings.

  The gate also applies your account's central policy (configured in the dashboard):
  the baseline failOn set, warn window, and fail-on-unknown. Explicit local flags
  override the policy; pass --no-policy to ignore it and use only local flags.

sync
  Discovers the models referenced in your codebase (same scan as check) and registers
  them as your account's watched set, so push alerts (webhook/Slack/PagerDuty) track
  your real footprint with no manual upkeep. Run it in CI on merge to keep the set in
  sync with your code. Replaces the watch set by default; use --no-prune to only add.
  Requires a paid plan.

Options:
  -m, --models <a,b,c>     Explicit model ids/aliases (repeatable)
  -c, --config <file>      JSON config: { "models": [...], "paths": [...] }
      --api-url <url>      API base URL        (env LLMINTEL_API_URL, default https://llmintel.vercel.app)
      --api-key <key>      API key             (env LLMINTEL_API_KEY)
      --warn-days <n>      check: warn window in days (default 90)
      --fail-on-warn       check: exit non-zero on warnings too
      --fail-on-unknown    check: treat unresolved references as errors
      --no-policy          check: ignore the account's central policy (use local flags only)
      --optimize           check: also show advisory cheaper/faster model suggestions (paid; never fails the build)
      --dry-run            sync: print the diff without writing
      --no-prune           sync: only add models, never remove
      --json               Machine-readable JSON output
  -q, --quiet              Only print failures / changes
  -h, --help               Show this help
  -v, --version            Show version

Exit codes:
  0  success (check: all healthy; sync: applied or dry-run)
  1  check: one or more errors (retired / past due), or warnings with --fail-on-warn
  2  usage/configuration error
  3  API or network error
`;
