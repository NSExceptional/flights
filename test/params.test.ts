import { test } from "node:test";
import assert from "node:assert/strict";

import { buildQuery, validateQuery, FlagError, FLAG_SPECS } from "../src/params.ts";

test("maps enums, ints, and bools to SerpAPI codes", () => {
    const q = buildQuery({
        from: "AUS",
        to: "LHR",
        type: "round",
        depart: "2026-09-10",
        return: "2026-09-20",
        class: "business",
        "max-stops": "nonstop",
        adults: "2",
        "less-emissions": true,
        deep: true,
        sort: "price",
    });
    assert.equal(q.departure_id, "AUS");
    assert.equal(q.arrival_id, "LHR");
    assert.equal(q.type, "1");
    assert.equal(q.travel_class, "3");
    assert.equal(q.stops, "1"); // nonstop -> code 1
    assert.equal(q.adults, "2");
    assert.equal(q.emissions, "1");
    assert.equal(q.deep_search, "true");
    assert.equal(q.sort_by, "2");
});

test("max-stops friendly ceilings map correctly", () => {
    assert.equal(buildQuery({ "max-stops": "any" }).stops, "0");
    assert.equal(buildQuery({ "max-stops": "nonstop" }).stops, "1");
    assert.equal(buildQuery({ "max-stops": "1" }).stops, "2");
    assert.equal(buildQuery({ "max-stops": "2" }).stops, "3");
});

test("rejects an unknown enum value", () => {
    assert.throws(() => buildQuery({ class: "coach" }), FlagError);
    assert.throws(() => buildQuery({ "max-stops": "3" }), FlagError);
});

test("rejects a non-integer where an int is required", () => {
    assert.throws(() => buildQuery({ adults: "two" }), FlagError);
});

test("assembles multi_city_json from repeated --leg and forces type=3", () => {
    const q = buildQuery({ leg: ["AUS:CDG:2026-09-10", "NRT:AUS:2026-09-24:8,18"] });
    assert.equal(q.type, "3");
    const legs = JSON.parse(q.multi_city_json!);
    assert.deepEqual(legs, [
        { departure_id: "AUS", arrival_id: "CDG", date: "2026-09-10" },
        { departure_id: "NRT", arrival_id: "AUS", date: "2026-09-24", times: "8,18" },
    ]);
});

test("a single --leg string is accepted", () => {
    const q = buildQuery({ leg: "AUS:CDG:2026-09-10" });
    assert.equal(q.type, "3");
    assert.equal(JSON.parse(q.multi_city_json!).length, 1);
});

test("rejects a malformed --leg", () => {
    assert.throws(() => buildQuery({ leg: "AUS:CDG" }), FlagError);
    assert.throws(() => buildQuery({ leg: "AUS::2026-09-10" }), FlagError);
});

test("enforces documented mutual exclusions and trip-type rules", () => {
    assert.throws(() => buildQuery({ "include-airlines": "UA", "exclude-airlines": "AA" }), FlagError);
    assert.throws(() => buildQuery({ "departure-token": "x", "booking-token": "y" }), FlagError);
    assert.throws(() => buildQuery({ "no-cache": true, async: true }), FlagError);
    assert.throws(() => buildQuery({ type: "oneway", return: "2026-09-20" }), FlagError);
    assert.throws(() => buildQuery({ type: "multi" }), FlagError); // multi needs a leg
    assert.throws(() => buildQuery({ leg: "AUS:CDG:2026-09-10", type: "round" }), FlagError); // leg needs multi
});

test("validateQuery flags return_times on non-round trips", () => {
    assert.throws(() => validateQuery({ type: "2", return_times: "4,18" }, 0), FlagError);
});

test("return / return_times are rejected for multi-city too (round-trip only)", () => {
    assert.throws(() => buildQuery({ type: "multi", leg: "AUS:CDG:2026-09-10", return: "2026-10-01" }), FlagError);
    assert.throws(() => validateQuery({ type: "3", return_times: "8,18" }, 1), FlagError);
});

test("every FLAG_SPEC has a unique flag and a real target", () => {
    const seen = new Set<string>();
    for (const spec of FLAG_SPECS) {
        assert.ok(!seen.has(spec.flag), `duplicate flag ${spec.flag}`);
        seen.add(spec.flag);
        assert.ok(spec.help.length > 0, `${spec.flag} missing help`);
        if (spec.kind === "enum") assert.ok(spec.enumMap, `${spec.flag} enum without map`);
    }
    // Comma-separated OR support is documented on route flags.
    const from = FLAG_SPECS.find((s) => s.flag === "from");
    assert.match(from!.help, /comma/i);
});
