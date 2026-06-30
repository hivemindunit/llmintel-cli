import type { ApiListResponse, ApiModel, ApiOptimization } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Turn a thrown fetch error into a clear, actionable message. DNS/connection failures usually mean
 * the API base URL is wrong (e.g. a domain that isn't live yet), so we point users at the override
 * rather than leaving them to debug a bare "fetch failed".
 */
function networkError(base: string, cause: unknown): ApiError {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const text = `${raw} ${String((cause as { cause?: { code?: string } })?.cause?.code ?? "")}`;
  const unreachable = /ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR/i.test(text);
  if (unreachable) {
    return new ApiError(
      `Could not reach the LLMIntel API at ${base} (${raw}). ` +
        `Check the host is correct — override it with --api-url or the LLMINTEL_API_URL env var.`,
    );
  }
  return new ApiError(`Network error contacting ${base}: ${raw}`);
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Injectable for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const PAGE_SIZE = 500;

/**
 * Fetch every tracked model from `GET /v1/models`, following pagination until the page is short.
 * The CLI needs the full set to resolve arbitrary references against ids and aliases.
 */
export async function fetchAllModels(options: ClientOptions): Promise<ApiModel[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  const all: ApiModel[] = [];
  let offset = 0;

  for (;;) {
    const url = `${base}/v1/models?limit=${PAGE_SIZE}&offset=${offset}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
      });
    } catch (cause) {
      throw networkError(base, cause);
    }

    if (!response.ok) {
      let code: string | undefined;
      let message = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as { error?: string; message?: string };
        code = body.error;
        if (body.message) message = body.message;
      } catch {
        // Non-JSON error body; keep the status line.
      }
      throw new ApiError(message, response.status, code);
    }

    const body = (await response.json()) as ApiListResponse;
    all.push(...body.data);
    if (body.data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return all;
}

export interface SyncWatchesResponse {
  added: string[];
  removed: string[];
  unchanged: string[];
  unresolved: string[];
}

export interface SyncOptions extends ClientOptions {
  models: string[];
  prune: boolean;
}

/**
 * Reconcile the account's watched-model set from a list of references via `PUT /v1/watches`. The
 * server resolves ids/aliases to canonical models and replaces (or, with `prune: false`, augments)
 * the watch set, returning the diff.
 */
export async function syncWatches(options: SyncOptions): Promise<SyncWatchesResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  const url = `${base}/v1/watches`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ models: options.models, prune: options.prune }),
    });
  } catch (cause) {
    throw networkError(base, cause);
  }

  if (!response.ok) {
    let code: string | undefined;
    let message = `${response.status} ${response.statusText}`;
    try {
      const errBody = (await response.json()) as { error?: string; message?: string };
      code = errBody.error;
      if (errBody.message) message = errBody.message;
    } catch {
      // Non-JSON error body; keep the status line.
    }
    throw new ApiError(message, response.status, code);
  }

  const body = (await response.json()) as { data: SyncWatchesResponse };
  return body.data;
}

export interface RemotePolicy {
  failOn: string[];
  warnWindowDays: number;
  failOnUnknown: boolean;
  /** Whether the account's plan entitles stricter-than-default policy (for messaging). */
  policyGating: boolean;
}

/** Fetch the account's effective (entitlement-clamped) CI gate policy via `GET /v1/policy`. */
export async function fetchPolicy(options: ClientOptions): Promise<RemotePolicy> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  const url = `${base}/v1/policy`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
    });
  } catch (cause) {
    throw networkError(base, cause);
  }

  if (!response.ok) {
    let code: string | undefined;
    let message = `${response.status} ${response.statusText}`;
    try {
      const errBody = (await response.json()) as { error?: string; message?: string };
      code = errBody.error;
      if (errBody.message) message = errBody.message;
    } catch {
      // Non-JSON error body; keep the status line.
    }
    throw new ApiError(message, response.status, code);
  }

  const body = (await response.json()) as { data: RemotePolicy };
  return body.data;
}

export interface OptimizationOptions extends ClientOptions {
  modelId: string;
}

/**
 * Fetch advisory optimization candidates for a single model via `GET /v1/models/{id}`. Returns the
 * candidate list (possibly empty) for paid keys, or `null` when the account is not entitled (the API
 * returns `optimization: null`). The model id contains a slash, so each segment is encoded into the
 * catch-all path. Callers treat this as best-effort: a 404/network error throws an {@link ApiError}
 * the caller can swallow, since optimization is advisory and must never affect the gate result.
 */
export async function fetchOptimization(options: OptimizationOptions): Promise<ApiOptimization | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  const path = options.modelId.split("/").map(encodeURIComponent).join("/");
  const url = `${base}/v1/models/${path}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${options.apiKey}`, accept: "application/json" },
    });
  } catch (cause) {
    throw networkError(base, cause);
  }

  if (!response.ok) {
    let code: string | undefined;
    let message = `${response.status} ${response.statusText}`;
    try {
      const errBody = (await response.json()) as { error?: string; message?: string };
      code = errBody.error;
      if (errBody.message) message = errBody.message;
    } catch {
      // Non-JSON error body; keep the status line.
    }
    throw new ApiError(message, response.status, code);
  }

  const body = (await response.json()) as { data: { optimization: ApiOptimization | null } };
  return body.data.optimization ?? null;
}
