#!/usr/bin/env node
/**
 * `flights` — a CLI over SerpAPI's Google Flights engine.
 *
 *   flights search  — one faithful request; a flag for every documented API option.
 *   flights scan    — search a criteria across many months / open-jaw cities.
 *
 * Runs on Node's native TypeScript (no build step). Key: SERPAPI_API_KEY (or --api-key).
 */
import { parseArgs } from "node:util";

import {
    FLAG_SPECS,
    buildParseArgsOptions,
    buildQuery,
    renderFlagHelp,
    FlagError,
    STOPS_MAP,
    CLASS_MAP,
} from "./params.ts";
import { searchFlights, resolveApiKey, buildSearchParams, SERPAPI_ENDPOINT, SerpApiError, API_KEY_ENV } from "./serpapi.ts";
import { renderSearchTable } from "./render.ts";
import {
    buildScanPlan,
    runScanPlan,
    rankHits,
    renderScanTable,
    scanHitsToJson,
    scanHitsToCsv,
    describePlan,
    type ScanConfig,
    type ScanSort,
} from "./scan.ts";
import type { PostFilterOptions } from "./postfilter.ts";

const VERSION = "0.1.0";

const MAIN_USAGE = `flights — search Google Flights via SerpAPI

Usage:
  flights search [options]     One request; every documented API lever is a flag.
  flights scan   [options]     Find a trip across months / open-jaw cities.
  flights help [search|scan]   Detailed help.
  flights --version

Setup:
  Set ${API_KEY_ENV} (or pass --api-key). Key: https://serpapi.com/manage-api-key

Examples:
  flights search --from AUS --to LHR --depart 2026-09-10 --return 2026-09-20 --max-stops nonstop
  flights search --type multi --leg AUS:CDG:2026-09-10 --leg NRT:AUS:2026-09-24
  flights scan --home AUS --cities DUB,SNN --open-jaw --months 2026-09..2026-11 --nights 10-14 \\
               --max-stops 1 --max-price 900 --dow fri,sat --top 20 --dry-run`;

function printMainHelp(): void {
    console.log(MAIN_USAGE);
}

function printSearchHelp(): void {
    console.log(`flights search — one Google Flights request (one SerpAPI credit).

Every option below maps to a documented SerpAPI google_flights parameter.

${renderFlagHelp(FLAG_SPECS)}  CLI:
    --api-key KEY                      Override ${API_KEY_ENV}.
    --out table|json                   Output format (default table).
    --raw                              Print the raw SerpAPI JSON response.
    -h, --help                         This help.`);
}

function printScanHelp(): void {
    console.log(`flights scan — search a trip across a date window / open-jaw cities.

The API has no date-range search, so scan expands (dates × trip-lengths × open-jaw
orientations) into one request each, under a credit budget. Always try --dry-run first.

  Route:
    --home IDS                         Home airport(s) (comma = OR).
    --cities C1[,C2]                   Destination city/airport id(s).
    --open-jaw                         With two --cities, try BOTH in/out orientations.
    --into IDS / --outof IDS           Fixed open jaw: arrive INTO, depart OUT OF.
    --baseline                         Also price straight round trips (comparison).
  Dates:
    --months YYYY-MM[..YYYY-MM]        Month window.
    --from-date / --to-date YYYY-MM-DD Explicit day window.
    --nights N | LO-HI                 Trip length(s). Omit for a one-way scan.
    --dow mon,tue,...                  Restrict outbound weekdays.
    --depart-times H,H[,H,H]           Outbound time window.
  Filters (server-side):
    --max-price N   --max-stops any|nonstop|1|2   --class economy|premium|business|first
    --include-airlines / --exclude-airlines CODES
    --currency CUR  --gl CC  --hl LL
  Filters (post, client-side):
    --exact-stops N                    Exactly N stops (API only does "N or fewer").
    --max-total-duration MIN           Cap total trip minutes.
    --max-layover MIN                  Cap the longest layover minutes.
  Run & output:
    --concurrency N                    Parallel requests (default 6).
    --max-credits N                    Refuse a plan larger than this (default 300).
    --dry-run                          Print the plan + estimated credits, then exit.
    --top N                            Keep the N cheapest overall.
    --per-date                         Keep the cheapest per outbound date.
    --sort price|duration|stops        Ranking (default price).
    --out table|json|csv               Output format (default table).
    --api-key KEY                      Override ${API_KEY_ENV}.
    -h, --help                         This help.`);
}

// ── search ───────────────────────────────────────────────────────────────────

async function runSearch(rest: string[]): Promise<void> {
    const options = buildParseArgsOptions(FLAG_SPECS, {
        "api-key": { type: "string" },
        out: { type: "string" },
        raw: { type: "boolean" },
        help: { type: "boolean", short: "h" },
    });
    const { values } = parseArgs({ args: rest, options, allowPositionals: false, strict: true });
    if (values["help"]) return printSearchHelp();

    const query = buildQuery(values as Record<string, unknown>);
    const apiKey = values["api-key"] as string | undefined;
    const currency = query.currency ?? "USD";

    // Raw non-json SerpAPI output (html) is printed verbatim.
    if (query.output === "html") {
        const url = `${SERPAPI_ENDPOINT}?${buildSearchParams(query, resolveApiKey(apiKey)).toString()}`;
        const response = await fetch(url);
        console.log(await response.text());
        return;
    }

    const response = await searchFlights(query, { ...(apiKey ? { apiKey } : {}) });
    const out = (values["out"] as string | undefined) ?? "table";
    if (values["raw"] || out === "json") {
        console.log(JSON.stringify(response, null, 2));
        return;
    }
    if (out !== "table") throw new FlagError(`--out must be table or json, got "${out}".`);
    console.log(renderSearchTable(response, currency));
}

// ── scan ─────────────────────────────────────────────────────────────────────

function intFlag(values: Record<string, unknown>, name: string): number | undefined {
    const raw = values[name];
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(String(raw))) throw new FlagError(`--${name} expects a non-negative integer, got "${String(raw)}".`);
    return Number(raw);
}

function splitList(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    return String(value)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function mapEnum(values: Record<string, unknown>, name: string, map: Readonly<Record<string, string>>): string | undefined {
    const raw = values[name];
    if (raw === undefined) return undefined;
    const mapped = map[String(raw)];
    if (mapped === undefined) throw new FlagError(`--${name} must be one of ${Object.keys(map).join("|")}, got "${String(raw)}".`);
    return mapped;
}

async function runScan(rest: string[]): Promise<void> {
    const { values } = parseArgs({
        args: rest,
        strict: true,
        allowPositionals: false,
        options: {
            home: { type: "string" },
            cities: { type: "string" },
            "open-jaw": { type: "boolean" },
            into: { type: "string" },
            outof: { type: "string" },
            baseline: { type: "boolean" },
            months: { type: "string" },
            "from-date": { type: "string" },
            "to-date": { type: "string" },
            nights: { type: "string" },
            dow: { type: "string" },
            "depart-times": { type: "string" },
            "max-price": { type: "string" },
            "max-stops": { type: "string" },
            class: { type: "string" },
            "include-airlines": { type: "string" },
            "exclude-airlines": { type: "string" },
            currency: { type: "string" },
            gl: { type: "string" },
            hl: { type: "string" },
            "exact-stops": { type: "string" },
            "max-total-duration": { type: "string" },
            "max-layover": { type: "string" },
            concurrency: { type: "string" },
            "max-credits": { type: "string" },
            "dry-run": { type: "boolean" },
            top: { type: "string" },
            "per-date": { type: "boolean" },
            sort: { type: "string" },
            out: { type: "string" },
            "api-key": { type: "string" },
            help: { type: "boolean", short: "h" },
        },
    });
    if (values["help"]) return printScanHelp();

    const v = values as Record<string, unknown>;
    const home = v["home"] as string | undefined;
    if (!home) throw new FlagError("scan requires --home.");

    const includeAirlines = v["include-airlines"] as string | undefined;
    const excludeAirlines = v["exclude-airlines"] as string | undefined;
    if (includeAirlines && excludeAirlines) throw new FlagError("--include-airlines and --exclude-airlines are mutually exclusive.");

    const post: PostFilterOptions = {
        ...(intFlag(v, "exact-stops") !== undefined ? { exactStops: intFlag(v, "exact-stops") } : {}),
        ...(intFlag(v, "max-price") !== undefined ? { maxPrice: intFlag(v, "max-price") } : {}),
        ...(intFlag(v, "max-total-duration") !== undefined ? { maxTotalDuration: intFlag(v, "max-total-duration") } : {}),
        ...(intFlag(v, "max-layover") !== undefined ? { maxLayover: intFlag(v, "max-layover") } : {}),
    };

    const config: ScanConfig = {
        home,
        ...(splitList(v["cities"]) ? { cities: splitList(v["cities"]) } : {}),
        ...(v["open-jaw"] ? { openJaw: true } : {}),
        ...(v["into"] ? { inbound: v["into"] as string } : {}),
        ...(v["outof"] ? { outbound: v["outof"] as string } : {}),
        ...(v["baseline"] ? { baseline: true } : {}),
        ...(v["months"] ? { months: v["months"] as string } : {}),
        ...(v["from-date"] ? { fromDate: v["from-date"] as string } : {}),
        ...(v["to-date"] ? { toDate: v["to-date"] as string } : {}),
        ...(v["nights"] ? { nights: v["nights"] as string } : {}),
        ...(splitList(v["dow"]) ? { dow: splitList(v["dow"]) } : {}),
        ...(v["depart-times"] ? { departTimes: v["depart-times"] as string } : {}),
        ...(intFlag(v, "max-price") !== undefined ? { maxPrice: intFlag(v, "max-price") } : {}),
        ...(mapEnum(v, "max-stops", STOPS_MAP) ? { stops: mapEnum(v, "max-stops", STOPS_MAP) } : {}),
        ...(mapEnum(v, "class", CLASS_MAP) ? { travelClass: mapEnum(v, "class", CLASS_MAP) } : {}),
        ...(includeAirlines ? { includeAirlines } : {}),
        ...(excludeAirlines ? { excludeAirlines } : {}),
        ...(v["currency"] ? { currency: v["currency"] as string } : {}),
        ...(v["gl"] ? { gl: v["gl"] as string } : {}),
        ...(v["hl"] ? { hl: v["hl"] as string } : {}),
        post,
    };

    const plan = buildScanPlan(config);
    const maxCredits = intFlag(v, "max-credits") ?? 300;
    const currency = config.currency ?? "USD";

    if (v["dry-run"]) {
        console.log(describePlan(plan, maxCredits));
        return;
    }
    if (plan.length === 0) {
        console.log("Plan is empty — check your date window and destinations.");
        return;
    }
    if (plan.length > maxCredits) {
        throw new FlagError(
            `Plan is ${plan.length} searches but --max-credits is ${maxCredits}. ` +
                `Raise --max-credits, narrow the window (--months/--dow/--nights), or --dry-run to preview.`,
        );
    }

    const apiKey = v["api-key"] as string | undefined;
    process.stderr.write(`Running ${plan.length} searches (concurrency ${intFlag(v, "concurrency") ?? 6})…\n`);
    const { hits, failures } = await runScanPlan(plan, {
        ...(apiKey ? { apiKey } : {}),
        ...(intFlag(v, "concurrency") !== undefined ? { concurrency: intFlag(v, "concurrency") } : {}),
        onProgress: (done, total) => process.stderr.write(`\r  ${done}/${total} done`),
    });
    process.stderr.write("\n");
    if (failures.length > 0) {
        process.stderr.write(`Note: ${failures.length}/${plan.length} searches failed or had no availability (skipped).\n`);
    }

    const sort = (mapEnum(v, "sort", { price: "price", duration: "duration", stops: "stops" }) as ScanSort | undefined) ?? "price";
    const ranked = rankHits(hits, {
        post,
        sort,
        ...(intFlag(v, "top") !== undefined ? { top: intFlag(v, "top") } : {}),
        ...(v["per-date"] ? { perDate: true } : {}),
    });

    const out = (v["out"] as string | undefined) ?? "table";
    if (out === "json") console.log(JSON.stringify(scanHitsToJson(ranked), null, 2));
    else if (out === "csv") console.log(scanHitsToCsv(ranked));
    else if (out === "table") console.log(renderScanTable(ranked, currency));
    else throw new FlagError(`--out must be table, json, or csv, got "${out}".`);
}

// ── entry ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const command = argv[0];
    const rest = argv.slice(1);

    if (command === undefined || command === "--help" || command === "-h" || command === "help") {
        const topic = command === "help" ? rest[0] : undefined;
        if (topic === "search") return printSearchHelp();
        if (topic === "scan") return printScanHelp();
        return printMainHelp();
    }
    if (command === "--version" || command === "-v" || command === "version") {
        console.log(VERSION);
        return;
    }
    if (command === "search") return runSearch(rest);
    if (command === "scan") return runScan(rest);

    console.error(`Unknown command "${command}". Try: flights help`);
    process.exitCode = 1;
}

main().catch((error: unknown) => {
    if (error instanceof FlagError || error instanceof SerpApiError) {
        console.error(`error: ${error.message}`);
    } else if (error instanceof Error) {
        console.error(`error: ${error.message}`);
    } else {
        console.error(`error: ${String(error)}`);
    }
    process.exitCode = 1;
});
