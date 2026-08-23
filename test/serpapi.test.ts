import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveApiKey, buildSearchParams, searchFlights, SerpApiError } from "../src/serpapi.ts";
import type { SerpFlightsResponse } from "../src/types.ts";

function mockResponse(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as unknown as Response;
}

test("resolveApiKey prefers explicit, falls back to env, else throws", () => {
    assert.equal(resolveApiKey("explicit", {}), "explicit");
    assert.equal(resolveApiKey(undefined, { SERPAPI_API_KEY: "fromenv" }), "fromenv");
    assert.throws(() => resolveApiKey(undefined, {}), SerpApiError);
    assert.throws(() => resolveApiKey("   ", { SERPAPI_API_KEY: "  " }), SerpApiError);
});

test("buildSearchParams adds engine/api_key and drops empty values", () => {
    const params = buildSearchParams({ departure_id: "AUS", arrival_id: "", stops: "1" }, "KEY");
    assert.equal(params.get("engine"), "google_flights");
    assert.equal(params.get("api_key"), "KEY");
    assert.equal(params.get("departure_id"), "AUS");
    assert.equal(params.get("stops"), "1");
    assert.equal(params.has("arrival_id"), false);
});

test("searchFlights returns the parsed body on success", async () => {
    const body: SerpFlightsResponse = { best_flights: [{ price: 123 }] };
    let calledUrl = "";
    const res = await searchFlights(
        { departure_id: "AUS", arrival_id: "LHR", outbound_date: "2026-09-10" },
        {
            apiKey: "KEY",
            fetchImpl: async (url) => {
                calledUrl = String(url);
                return mockResponse(200, body);
            },
        },
    );
    assert.deepEqual(res.best_flights, [{ price: 123 }]);
    assert.match(calledUrl, /engine=google_flights/);
    assert.match(calledUrl, /departure_id=AUS/);
});

test("searchFlights throws SerpAPI's own error field without retrying", async () => {
    let calls = 0;
    await assert.rejects(
        searchFlights(
            {},
            {
                apiKey: "KEY",
                backoffMs: 0,
                fetchImpl: async () => {
                    calls++;
                    return mockResponse(200, { error: "Invalid API key" });
                },
            },
        ),
        (e: unknown) => e instanceof SerpApiError && /Invalid API key/.test((e as Error).message),
    );
    assert.equal(calls, 1);
});

test("searchFlights retries 429 then succeeds", async () => {
    let calls = 0;
    const res = await searchFlights(
        {},
        {
            apiKey: "KEY",
            backoffMs: 0,
            retries: 3,
            fetchImpl: async () => {
                calls++;
                return calls < 3 ? mockResponse(429, {}) : mockResponse(200, { best_flights: [] });
            },
        },
    );
    assert.equal(calls, 3);
    assert.deepEqual(res.best_flights, []);
});

test("searchFlights retries a network error then succeeds", async () => {
    let calls = 0;
    const res = await searchFlights(
        {},
        {
            apiKey: "KEY",
            backoffMs: 0,
            fetchImpl: async () => {
                calls++;
                if (calls === 1) throw new Error("ECONNRESET");
                return mockResponse(200, { best_flights: [{ price: 1 }] });
            },
        },
    );
    assert.equal(calls, 2);
    assert.equal(res.best_flights?.[0]?.price, 1);
});

test("searchFlights gives up after exhausting retries on 5xx", async () => {
    let calls = 0;
    await assert.rejects(
        searchFlights({}, { apiKey: "KEY", backoffMs: 0, retries: 2, fetchImpl: async () => {
            calls++;
            return mockResponse(503, {});
        } }),
        SerpApiError,
    );
    assert.equal(calls, 3); // initial + 2 retries
});
