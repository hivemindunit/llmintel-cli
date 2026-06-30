import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL, parseArgs, UsageError } from "./args";

describe("parseArgs", () => {
  it("defaults to help with no args", () => {
    expect(parseArgs([], {}).command).toBe("help");
  });

  it("parses the check subcommand with paths and flags", () => {
    const opts = parseArgs(
      ["check", "src", "config.yaml", "--models", "gpt-4o,claude-opus-4-1", "--warn-days", "30", "--fail-on-warn"],
      {},
    );
    expect(opts.command).toBe("check");
    expect(opts.paths).toEqual(["src", "config.yaml"]);
    expect(opts.models).toEqual(["gpt-4o", "claude-opus-4-1"]);
    expect(opts.warnDays).toBe(30);
    expect(opts.failOnWarn).toBe(true);
  });

  it("treats a leading path as an implicit check command", () => {
    const opts = parseArgs(["src/", "--json"], {});
    expect(opts.command).toBe("check");
    expect(opts.paths).toEqual(["src/"]);
    expect(opts.json).toBe(true);
  });

  it("reads api url/key from env, with flags taking precedence", () => {
    const env = { LLMINTEL_API_URL: "https://env.example", LLMINTEL_API_KEY: "envkey" };
    expect(parseArgs(["check", "x"], env).apiUrl).toBe("https://env.example");
    expect(parseArgs(["check", "x"], env).apiKey).toBe("envkey");
    expect(parseArgs(["check", "x", "--api-key", "flagkey"], env).apiKey).toBe("flagkey");
    expect(parseArgs(["check", "x"], {}).apiUrl).toBe(DEFAULT_API_URL);
  });

  it("rejects unknown flags and bad numbers", () => {
    expect(() => parseArgs(["check", "--nope"], {})).toThrow(UsageError);
    expect(() => parseArgs(["check", "--warn-days", "-5"], {})).toThrow(UsageError);
    expect(() => parseArgs(["check", "--models"], {})).toThrow(UsageError);
  });
});
