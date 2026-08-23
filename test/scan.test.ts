import { test } from "node:test";
import assert from "node:assert/strict";

import {
    parseIsoDate,
    formatIsoDate,
    addDays,
    resolveDateWindow,
    expandDates,
    parseNights,
    buildScanPlan,
    runScanPlan,
    rankHits,
    type ScanConfig,
    type ScanHit,
} from "../src/scan.ts";
import type { FlightItinerary } from "../src/types.ts";

function mockResponse(body: unknown): Response {
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as unknown as Response;
}

test("date helpers are UTC-stable", () => {
    assert.equal(formatIsoDate(parseIsoDate("2026-09-10")), "2026-09-10");
    assert.equal(addDays("2026-09-10", 12), "2026-09-22");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.throws(() => parseIsoDate("2026/09/10"));
});

test("resolveDateWindow handles month ranges and explicit dates", () => {
    assert.deepEqual(resolveDateWindow({ months: "2026-09..2026-11" }), { start: "2026-09-01", end: "2026-11-30" });
    assert.deepEqual(resolveDateWindow({ months: "2026-02" }), { start: "2026-02-01", end: "2026-02-28" });
    assert.deepEqual(resolveDateWindow({ fromDate: "2026-09-10", toDate: "2026-09-12" }), { start: "2026-09-10", end: "2026-09-12" });
    assert.throws(() => resolveDateWindow({}));
});

test("expandDates enumerates days and filters weekdays", () => {
    const all = expandDates("2026-09-01", "2026-09-07");
    assert.equal(all.length, 7);
    const fri = expandDates("2026-09-01", "2026-09-30", ["fri"]);
    // Sept 2026 Fridays: 4, 11, 18, 25
    assert.deepEqual(fri, ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"]);
    assert.throws(() => expandDates("2026-09-10", "2026-09-01")); // end before start
});

test("parseNights supports single and ranges", () => {
    assert.deepEqual(parseNights("10"), [10]);
    assert.deepEqual(parseNights("10-14"), [10, 11, 12, 13, 14]);
    assert.throws(() => parseNights("14-10"));
    assert.throws(() => parseNights("abc"));
});

test("open-jaw plan generates both orientations as multi_city queries", () => {
    const config: ScanConfig = {
        home: "AUS",
        cities: ["DUB", "SNN"],
        openJaw: true,
        fromDate: "2026-09-04",
        toDate: "2026-09-04",
        nights: "10",
        post: {},
    };
    const plan = buildScanPlan(config);
    assert.equal(plan.length, 2); // 1 date × 1 nights × 2 orientations
    const labels = plan.map((t) => t.orientation).sort();
    assert.deepEqual(labels, ["in DUB / out SNN", "in SNN / out DUB"]);

    const dubIn = plan.find((t) => t.orientation === "in DUB / out SNN")!;
    assert.equal(dubIn.query.type, "3");
    const legs = JSON.parse(dubIn.query.multi_city_json!);
    assert.deepEqual(legs, [
        { departure_id: "AUS", arrival_id: "DUB", date: "2026-09-04" },
        { departure_id: "SNN", arrival_id: "AUS", date: "2026-09-14" },
    ]);
});

test("open-jaw requires exactly two cities", () => {
    assert.throws(() => buildScanPlan({ home: "AUS", cities: ["DUB"], openJaw: true, months: "2026-09", nights: "10", post: {} }));
});

test("open-jaw without --nights is refused (would emit mislabeled one-ways)", () => {
    assert.throws(
        () => buildScanPlan({ home: "AUS", cities: ["DUB", "SNN"], openJaw: true, months: "2026-09", post: {} }),
        /return leg/,
    );
});

test("straight round-trip scan uses type=1", () => {
    const plan = buildScanPlan({ home: "AUS", cities: ["LHR"], fromDate: "2026-09-04", toDate: "2026-09-04", nights: "7", post: {} });
    assert.equal(plan.length, 1);
    assert.equal(plan[0]!.query.type, "1");
    assert.equal(plan[0]!.query.arrival_id, "LHR");
    assert.equal(plan[0]!.query.return_date, "2026-09-11");
});

test("one-way scan (no nights) uses type=2 with no return", () => {
    const plan = buildScanPlan({ home: "AUS", cities: ["LHR"], fromDate: "2026-09-04", toDate: "2026-09-04", post: {} });
    assert.equal(plan[0]!.query.type, "2");
    assert.equal(plan[0]!.query.return_date, undefined);
    assert.equal(plan[0]!.returnDate, undefined);
});

test("plan size is dates × nights × orientations", () => {
    const plan = buildScanPlan({
        home: "AUS",
        cities: ["DUB", "SNN"],
        openJaw: true,
        fromDate: "2026-09-01",
        toDate: "2026-09-03",
        nights: "10-12",
        post: {},
    });
    assert.equal(plan.length, 3 * 3 * 2);
});

function hit(price: number, date: string, stops: number, duration: number): ScanHit {
    const flights = Array.from({ length: stops + 1 }, () => ({}));
    const itinerary: FlightItinerary = { price, total_duration: duration, flights };
    return { task: { outboundDate: date, orientation: "x", query: {} }, itinerary };
}

test("rankHits post-filters, sorts, and applies top / per-date", () => {
    const hits = [hit(500, "2026-09-04", 1, 600), hit(300, "2026-09-04", 0, 700), hit(400, "2026-09-11", 2, 500)];

    const cheapestTop2 = rankHits(hits, { post: {}, sort: "price", top: 2 });
    assert.deepEqual(cheapestTop2.map((h) => h.itinerary.price), [300, 400]);

    const nonstopOnly = rankHits(hits, { post: { exactStops: 0 }, sort: "price" });
    assert.deepEqual(nonstopOnly.map((h) => h.itinerary.price), [300]);

    const perDate = rankHits(hits, { post: {}, sort: "price", perDate: true });
    assert.equal(perDate.length, 2); // one per outbound date
    assert.deepEqual(perDate.map((h) => h.task.outboundDate).sort(), ["2026-09-04", "2026-09-11"]);
});

test("rankHits --top 0 returns nothing (not everything)", () => {
    assert.equal(rankHits([hit(300, "2026-09-04", 0, 600)], { post: {}, sort: "price", top: 0 }).length, 0);
});

test("runScanPlan skips a failing/empty search and keeps the others", async () => {
    const plan = buildScanPlan({ home: "AUS", cities: ["LHR", "CDG"], fromDate: "2026-09-04", toDate: "2026-09-04", nights: "7", post: {} });
    assert.equal(plan.length, 2);
    const result = await runScanPlan(plan, {
        apiKey: "K",
        backoffMs: 0,
        retries: 0,
        concurrency: 1,
        fetchImpl: async (url) =>
            String(url).includes("CDG") ? mockResponse({ error: "no results for this query" }) : mockResponse({ best_flights: [{ price: 500 }] }),
    });
    assert.equal(result.hits.length, 1);
    assert.equal(result.failures.length, 1);
    assert.equal(result.hits[0]!.itinerary.price, 500);
});
