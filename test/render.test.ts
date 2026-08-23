import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDuration, formatPrice, stopCount, route, airlines, itineraryLine, collectItineraries, renderSearchTable } from "../src/render.ts";
import type { FlightItinerary, SerpFlightsResponse } from "../src/types.ts";

test("formatDuration renders hours and minutes", () => {
    assert.equal(formatDuration(330), "5h 30m");
    assert.equal(formatDuration(60), "1h");
    assert.equal(formatDuration(45), "45m");
    assert.equal(formatDuration(undefined), "?");
});

test("formatPrice uses currency, handles missing", () => {
    assert.equal(formatPrice(900, "USD"), "$900");
    assert.equal(formatPrice(undefined), "—");
    assert.equal(formatPrice(100, "NOTACURRENCY"), "100 NOTACURRENCY");
});

const twoStop: FlightItinerary = {
    price: 742,
    total_duration: 900,
    flights: [
        { airline: "United", flight_number: "UA 1", departure_airport: { id: "AUS", time: "2026-09-10 07:00" }, arrival_airport: { id: "IAH" } },
        { airline: "United", flight_number: "UA 2", departure_airport: { id: "IAH" }, arrival_airport: { id: "LHR" } },
    ],
    layovers: [{ id: "IAH", duration: 90 }],
};

test("stopCount, route, airlines derive from segments/layovers", () => {
    assert.equal(stopCount(twoStop), 1);
    assert.deepEqual(route(twoStop), { from: "AUS", to: "LHR" });
    assert.deepEqual(airlines(twoStop), ["United"]);
});

test("itineraryLine includes price, route, stops, duration, via", () => {
    const line = itineraryLine(twoStop, "USD");
    assert.match(line, /\$742/);
    assert.match(line, /AUS→LHR/);
    assert.match(line, /1 stop/);
    assert.match(line, /via IAH/);
});

test("collectItineraries merges best then other", () => {
    const response: SerpFlightsResponse = { best_flights: [{ price: 1 }], other_flights: [{ price: 2 }] };
    assert.deepEqual(collectItineraries(response).map((i) => i.price), [1, 2]);
});

test("renderSearchTable shows insight, sections, and count", () => {
    const response: SerpFlightsResponse = {
        best_flights: [twoStop],
        other_flights: [{ price: 999, flights: [{ airline: "BA", departure_airport: { id: "AUS" }, arrival_airport: { id: "LHR" } }] }],
        price_insights: { lowest_price: 742, price_level: "low", typical_price_range: [700, 1200] },
    };
    const table = renderSearchTable(response, "USD");
    assert.match(table, /Price insight/);
    assert.match(table, /Best:/);
    assert.match(table, /Other:/);
    assert.match(table, /2 itineraries/);
});

test("renderSearchTable handles no results", () => {
    assert.equal(renderSearchTable({}, "USD"), "No flights found.");
});
