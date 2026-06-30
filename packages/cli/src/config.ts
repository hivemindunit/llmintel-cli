import { readFile } from "node:fs/promises";

export interface FileConfig {
  models?: string[];
  paths?: string[];
  warnDays?: number;
  apiUrl?: string;
}

export class ConfigError extends Error {}

/** Load and validate a JSON config file. */
export async function loadConfig(path: string): Promise<FileConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new ConfigError(`Cannot read config file "${path}": ${(cause as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(`Invalid JSON in "${path}": ${(cause as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ConfigError(`Config "${path}" must be a JSON object.`);
  }

  const config = parsed as Record<string, unknown>;
  const result: FileConfig = {};

  if (config.models !== undefined) {
    if (!Array.isArray(config.models) || config.models.some((m) => typeof m !== "string")) {
      throw new ConfigError(`Config "models" must be an array of strings.`);
    }
    result.models = config.models as string[];
  }
  if (config.paths !== undefined) {
    if (!Array.isArray(config.paths) || config.paths.some((p) => typeof p !== "string")) {
      throw new ConfigError(`Config "paths" must be an array of strings.`);
    }
    result.paths = config.paths as string[];
  }
  if (config.warnDays !== undefined) {
    if (typeof config.warnDays !== "number" || config.warnDays < 0) {
      throw new ConfigError(`Config "warnDays" must be a non-negative number.`);
    }
    result.warnDays = Math.floor(config.warnDays);
  }
  if (config.apiUrl !== undefined) {
    if (typeof config.apiUrl !== "string") throw new ConfigError(`Config "apiUrl" must be a string.`);
    result.apiUrl = config.apiUrl;
  }

  return result;
}
