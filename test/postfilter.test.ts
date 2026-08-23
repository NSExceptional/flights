import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFilters, applyFilters, dedupeItineraries, itinerarySignature } from "../src/postfilter.ts";
import type { FlightItinerary } from "../src/types.ts";

const nonstop: FlightItinerary = { price: 300, total_duration: 480, flights: [{ flight_number: "UA1", departure_airport: { time: "t1" } }], layovers: [] };
const oneStop: FlightItinerary = {
    price: 500,
    total_duration: 700,
    flights: [{ flight_number: "AA1", departure_airport: { time: "t2" } }, { flight_number: "AA2", departure_airport: { time: "t3" } }],
    layovers: [{ id: "DFW", duration: 400 }],
};

test("exactStops keeps only itineraries with that stop count", () => {
    const filters = buildFilters({ exactStops: 0 });
    assert.deepEqual(applyFilters([nonstop, oneStop], filters).map((i) => i.price), [300]);
});

test("price band filters low and high", () => {
    assert.deepEqual(applyFilters([nonstop, oneStop], buildFilters({ minPrice: 400 })).map((i) => i.price), [500]);
    assert.deepEqual(applyFilters([nonstop, oneStop], buildFilters({ maxPrice: 400 })).map((i) => i.price), [300]);
});

test("maxTotalDuration and maxLayover cap on minutes", () => {
    assert.deepEqual(applyFilters([nonstop, oneStop], buildFilters({ maxTotalDuration: 600 })).map((i) => i.price), [300]);
    assert.deepEqual(applyFilters([nonstop, oneStop], buildFilters({ maxLayover: 300 })).map((i) => i.price), [300]);
});

test("filters compose (AND)", () => {
    const filters = buildFilters({ maxPrice: 600, exactStops: 1 });
    assert.deepEqual(applyFilters([nonstop, oneStop], filters).map((i) => i.price), [500]);
});

test("dedupeItineraries drops identical signatures", () => {
    const dup: FlightItinerary = JSON.parse(JSON.stringify(nonstop));
    const out = dedupeItineraries([nonstop, dup, oneStop]);
    assert.equal(out.length, 2);
    assert.notEqual(itinerarySignature(nonstop), itinerarySignature(oneStop));
});
