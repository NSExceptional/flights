/**
 * Minimal SerpAPI client for the Google Flights engine. Dependency-free: uses the
 * global `fetch`. Resolves the key from `SERPAPI_API_KEY` (or an explicit override),
 * builds the request, retries transient failures, and surfaces SerpAPI's own `error`.
 */
import type { SerpFlightsQuery, SerpFlightsResponse } from "./types.ts";

export const SERPAPI_ENDPOINT = "https://serpapi.com/search";
export const API_KEY_ENV = "SERPAPI_API_KEY";

export class SerpApiError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.name = "SerpApiError";
        this.status = status;
    }
}

/** Resolve the SerpAPI key from an explicit value or the environment. */
export function resolveApiKey(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
    const key = explicit?.trim() || env[API_KEY_ENV]?.trim();
    if (!key) {
        throw new SerpApiError(
            `No SerpAPI key. Set the ${API_KEY_ENV} environment variable or pass --api-key. ` +
                `Get one at https://serpapi.com/manage-api-key`,
        );
    }
    return key;
}

/** Serialize a query into URLSearchParams, dropping undefined/empty values. */
export function buildSearchParams(query: SerpFlightsQuery, apiKey: string): URLSearchParams {
    const params = new URLSearchParams({ engine: "google_flights", api_key: apiKey });
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return params;
}

export interface FetchOptions {
    readonly apiKey?: string;
    readonly env?: NodeJS.ProcessEnv;
    /** Retry attempts for 429 / 5xx / network errors (default 3). */
    readonly retries?: number;
    /** Base backoff in ms, doubled each retry (default 800). */
    readonly backoffMs?: number;
    /** Per-request timeout in ms (default 30000). */
    readonly timeoutMs?: number;
    /** Injectable fetch, for tests. */
    readonly fetchImpl?: typeof fetch;
    /** Called before each retry sleep, for observability. */
    readonly onRetry?: (attempt: number, reason: string, delayMs: number) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run one Google Flights search. Returns the parsed response (which for a Google
 * Flights `output=json` request always includes best_flights/other_flights or an error).
 */
export async function searchFlights(
    query: SerpFlightsQuery,
    options: FetchOptions = {},
): Promise<SerpFlightsResponse> {
    const apiKey = resolveApiKey(options.apiKey, options.env);
    const retries = options.retries ?? 3;
    const backoffMs = options.backoffMs ?? 800;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const doFetch = options.fetchImpl ?? fetch;
    const url = `${SERPAPI_ENDPOINT}?${buildSearchParams(query, apiKey).toString()}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await doFetch(url, { signal: controller.signal });

            // Retry throttling and server errors; other non-2xx are terminal.
            if (response.status === 429 || response.status >= 500) {
                if (attempt < retries) {
                    const delay = backoffMs * 2 ** attempt;
                    options.onRetry?.(attempt + 1, `HTTP ${response.status}`, delay);
                    await sleep(delay);
                    continue;
                }
                throw new SerpApiError(`SerpAPI returned HTTP ${response.status}`, response.status);
            }

            // The timer stays armed through the body read, so a stalled response body
            // (headers sent, body withheld) is aborted and retried rather than hanging.
            const body = (await response.json()) as SerpFlightsResponse;
            if (body.error) throw new SerpApiError(body.error, response.status);
            if (!response.ok) throw new SerpApiError(`SerpAPI returned HTTP ${response.status}`, response.status);
            return body;
        } catch (error) {
            // A SerpAPI-reported error is terminal; network/abort/timeout errors retry.
            if (error instanceof SerpApiError) throw error;
            lastError = error;
            if (attempt < retries) {
                const delay = backoffMs * 2 ** attempt;
                const reason = error instanceof Error ? error.message : String(error);
                options.onRetry?.(attempt + 1, reason, delay);
                await sleep(delay);
                continue;
            }
        } finally {
            clearTimeout(timer);
        }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new SerpApiError(`SerpAPI request failed after ${retries + 1} attempts: ${detail}`);
}
