/**
 * `scan` — the higher-level driver for the owner's core use case: find a trip meeting
 * criteria (price, stops, open-jaw cities) across SEVERAL MONTHS. The API has no
 * date-range search, so this expands a date window × trip-lengths × open-jaw
 * orientations into one search per tuple, runs them under a credit budget with bounded
 * concurrency, post-filters, ranks, and renders.
 */
import type { SerpFlightsQuery, FlightItinerary } from "./types.ts";
import { searchFlights, type FetchOptions } from "./serpapi.ts";
import { buildFilters, applyFilters, dedupeItineraries, type PostFilterOptions } from "./postfilter.ts";
import { FlagError } from "./params.ts";
import { collectItineraries, itineraryLine, stopCount, route, formatPrice, formatDuration, airlines } from "./render.ts";

// ── Date helpers (UTC, to avoid timezone drift on YYYY-MM-DD math) ──────────────

const DAY_MS = 86_400_000;
const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseIsoDate(iso: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!m) throw new Error(`Bad date "${iso}", expected YYYY-MM-DD`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatIsoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
    return formatIsoDate(parseIsoDate(iso) + days * DAY_MS);
}

function lastDayOfMonth(year: number, month1: number): number {
    return Date.UTC(year, month1, 0); // month1 as 1-based -> day 0 of next month = last day
}

/** Resolve a date window from `--months YYYY-MM[..YYYY-MM]` or explicit from/to. */
export function resolveDateWindow(input: {
    months?: string;
    fromDate?: string;
    toDate?: string;
}): { start: string; end: string } {
    if (input.months) {
        const [a, b] = input.months.split("..");
        const mA = /^(\d{4})-(\d{2})$/.exec((a ?? "").trim());
        if (!mA) throw new Error(`Bad --months "${input.months}", expected YYYY-MM or YYYY-MM..YYYY-MM`);
        const startYear = Number(mA[1]);
        const startMonth = Number(mA[2]);
        const start = `${mA[1]}-${mA[2]}-01`;
        let end: string;
        if (b) {
            const mB = /^(\d{4})-(\d{2})$/.exec(b.trim());
            if (!mB) throw new Error(`Bad --months "${input.months}"`);
            end = formatIsoDate(lastDayOfMonth(Number(mB[1]), Number(mB[2])));
        } else {
            end = formatIsoDate(lastDayOfMonth(startYear, startMonth));
        }
        return { start, end };
    }
    if (input.fromDate && input.toDate) return { start: input.fromDate, end: input.toDate };
    throw new Error("scan needs a date window: --months YYYY-MM..YYYY-MM, or --from-date and --to-date.");
}

/** Every day in [start, end], optionally restricted to certain weekdays. */
export function expandDates(start: string, end: string, dow?: readonly string[]): string[] {
    const startMs = parseIsoDate(start);
    const endMs = parseIsoDate(end);
    if (endMs < startMs) throw new Error(`Date window end (${end}) is before start (${start}).`);
    const allowed = dow && dow.length > 0 ? new Set(dow.map((d) => weekdayIndex(d))) : undefined;
    const out: string[] = [];
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
        if (allowed && !allowed.has(new Date(ms).getUTCDay())) continue;
        out.push(formatIsoDate(ms));
    }
    return out;
}

function weekdayIndex(name: string): number {
    const idx = WEEKDAYS[name.trim().toLowerCase().slice(0, 3)];
    if (idx === undefined) throw new Error(`Bad weekday "${name}" (use mon,tue,wed,thu,fri,sat,sun).`);
    return idx;
}

/** `"7-10"` -> [7,8,9,10]; `"7"` -> [7]. */
export function parseNights(spec: string): number[] {
    const range = /^(\d+)-(\d+)$/.exec(spec.trim());
    if (range) {
        const lo = Number(range[1]);
        const hi = Number(range[2]);
        if (hi < lo) throw new Error(`Bad --nights "${spec}" (max < min).`);
        return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    }
    if (/^\d+$/.test(spec.trim())) return [Number(spec.trim())];
    throw new Error(`Bad --nights "${spec}", expected N or LO-HI.`);
}

// ── Plan building ───────────────────────────────────────────────────────────

export interface ScanConfig {
    readonly home: string;
    /** Interchangeable destination cities for open-jaw, or a single destination. */
    readonly cities?: readonly string[];
    readonly openJaw?: boolean;
    /** Explicit open-jaw override: arrive at `in`, depart from `out`. */
    readonly inbound?: string;
    readonly outbound?: string;
    /** Also search straight round trips to each city as a comparison baseline. */
    readonly baseline?: boolean;

    readonly months?: string;
    readonly fromDate?: string;
    readonly toDate?: string;
    readonly nights?: string;
    readonly dow?: readonly string[];

    // Server-side filters shared by every generated query.
    readonly maxPrice?: number;
    readonly stops?: string; // SerpAPI code
    readonly travelClass?: string;
    readonly includeAirlines?: string;
    readonly excludeAirlines?: string;
    readonly departTimes?: string;
    readonly currency?: string;
    readonly gl?: string;
    readonly hl?: string;

    readonly post: PostFilterOptions;
}

export interface ScanTask {
    readonly outboundDate: string;
    readonly returnDate?: string;
    readonly nights?: number;
    readonly orientation: string;
    readonly query: SerpFlightsQuery;
}

export interface ScanHit {
    readonly task: ScanTask;
    readonly itinerary: FlightItinerary;
}

/** Shared server-side filters, applied to every query in the plan. */
function sharedQuery(config: ScanConfig): SerpFlightsQuery {
    const q: SerpFlightsQuery = { sort_by: "2" }; // price-first
    if (config.maxPrice !== undefined) q.max_price = String(config.maxPrice);
    if (config.stops) q.stops = config.stops as SerpFlightsQuery["stops"];
    if (config.travelClass) q.travel_class = config.travelClass as SerpFlightsQuery["travel_class"];
    if (config.includeAirlines) q.include_airlines = config.includeAirlines;
    if (config.excludeAirlines) q.exclude_airlines = config.excludeAirlines;
    if (config.departTimes) q.outbound_times = config.departTimes;
    if (config.currency) q.currency = config.currency;
    if (config.gl) q.gl = config.gl;
    if (config.hl) q.hl = config.hl;
    return q;
}

/** A destination pairing: which city you fly INTO and which you fly OUT of. */
interface Orientation {
    readonly label: string;
    readonly into: string;
    readonly outOf: string;
    readonly roundTrip: boolean;
}

function orientations(config: ScanConfig): Orientation[] {
    // Explicit open-jaw.
    if (config.inbound && config.outbound) {
        return [{ label: `in ${config.inbound} / out ${config.outbound}`, into: config.inbound, outOf: config.outbound, roundTrip: false }];
    }
    const cities = config.cities ?? [];
    if (config.openJaw) {
        if (cities.length !== 2) throw new Error("--open-jaw needs exactly two --cities (e.g. --cities DUB,SNN).");
        const [c1, c2] = cities as [string, string];
        const out: Orientation[] = [
            { label: `in ${c1} / out ${c2}`, into: c1, outOf: c2, roundTrip: false },
            { label: `in ${c2} / out ${c1}`, into: c2, outOf: c1, roundTrip: false },
        ];
        if (config.baseline) {
            out.push({ label: `RT ${c1}`, into: c1, outOf: c1, roundTrip: true });
            out.push({ label: `RT ${c2}`, into: c2, outOf: c1 === c2 ? c1 : c2, roundTrip: true });
        }
        return out;
    }
    // Straight trips to each destination (round trip if nights given, else one-way).
    if (cities.length === 0) throw new Error("scan needs a destination: --cities, or --in/--out for open-jaw.");
    return cities.map((c) => ({ label: c, into: c, outOf: c, roundTrip: true }));
}

/** Build one query for a (dates, orientation) combination. */
function buildTaskQuery(config: ScanConfig, orient: Orientation, outboundDate: string, returnDate: string | undefined): SerpFlightsQuery {
    const base = sharedQuery(config);
    // One-way: single dest, no return.
    if (returnDate === undefined) {
        return { ...base, type: "2", departure_id: config.home, arrival_id: orient.into, outbound_date: outboundDate };
    }
    // Straight round trip (into === outOf): the cheaper type=1 path.
    if (orient.roundTrip && orient.into === orient.outOf) {
        return { ...base, type: "1", departure_id: config.home, arrival_id: orient.into, outbound_date: outboundDate, return_date: returnDate };
    }
    // Open jaw: multi-city, home -> into, then outOf -> home.
    const legs = [
        { departure_id: config.home, arrival_id: orient.into, date: outboundDate },
        { departure_id: orient.outOf, arrival_id: config.home, date: returnDate },
    ];
    return { ...base, type: "3", multi_city_json: JSON.stringify(legs) };
}

export function buildScanPlan(config: ScanConfig): ScanTask[] {
    // An open jaw is inherently a return trip (out via a different city), so it needs a
    // return leg. Without --nights we'd silently emit one-way queries that drop the
    // "out of" city yet still get labeled as an open jaw — refuse instead.
    const isOpenJaw = config.openJaw === true || (config.inbound !== undefined && config.outbound !== undefined);
    if (isOpenJaw && !config.nights) {
        throw new FlagError("An open jaw needs a return leg — provide --nights.");
    }

    const window = resolveDateWindow(config);
    const dates = expandDates(window.start, window.end, config.dow);
    const nightsList = config.nights ? parseNights(config.nights) : undefined;
    const orients = orientations(config);

    const tasks: ScanTask[] = [];
    const seen = new Set<string>();
    for (const outboundDate of dates) {
        const returnDates: Array<{ date: string | undefined; nights: number | undefined }> = nightsList
            ? nightsList.map((n) => ({ date: addDays(outboundDate, n), nights: n }))
            : [{ date: undefined, nights: undefined }];
        for (const rd of returnDates) {
            for (const orient of orients) {
                const query = buildTaskQuery(config, orient, outboundDate, rd.date);
                const key = JSON.stringify(query);
                if (seen.has(key)) continue;
                seen.add(key);
                tasks.push({
                    outboundDate,
                    ...(rd.date ? { returnDate: rd.date } : {}),
                    ...(rd.nights !== undefined ? { nights: rd.nights } : {}),
                    orientation: orient.label,
                    query,
                });
            }
        }
    }
    return tasks;
}

// ── Execution ────────────────────────────────────────────────────────────────

export interface ScanFailure {
    readonly task: ScanTask;
    readonly error: string;
}

export interface ScanRunResult {
    readonly hits: ScanHit[];
    readonly failures: ScanFailure[];
}

export interface RunScanOptions extends FetchOptions {
    readonly concurrency?: number;
    /** Progress callback: completed count, total. */
    readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Run a plan under bounded concurrency, collecting every itinerary with its task.
 * A single failed search (e.g. a date with no availability, which SerpAPI reports as
 * a terminal error) is recorded and skipped — it never aborts the whole scan or
 * discards results already gathered from the other tuples.
 */
export async function runScanPlan(tasks: readonly ScanTask[], options: RunScanOptions = {}): Promise<ScanRunResult> {
    const concurrency = Math.max(1, options.concurrency ?? 6);
    const hits: ScanHit[] = [];
    const failures: ScanFailure[] = [];
    let next = 0;
    let done = 0;

    async function worker(): Promise<void> {
        while (true) {
            const index = next++;
            if (index >= tasks.length) return;
            const task = tasks[index]!;
            try {
                const response = await searchFlights(task.query, options);
                for (const itinerary of collectItineraries(response)) hits.push({ task, itinerary });
            } catch (error) {
                failures.push({ task, error: error instanceof Error ? error.message : String(error) });
            }
            done++;
            options.onProgress?.(done, tasks.length);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
    return { hits, failures };
}

// ── Ranking & rendering ──────────────────────────────────────────────────────

export type ScanSort = "price" | "duration" | "stops";

function sortHits(hits: ScanHit[], sort: ScanSort): ScanHit[] {
    const key: (h: ScanHit) => number =
        sort === "duration"
            ? (h) => h.itinerary.total_duration ?? Infinity
            : sort === "stops"
              ? (h) => stopCount(h.itinerary)
              : (h) => h.itinerary.price ?? Infinity;
    return [...hits].sort((a, b) => key(a) - key(b));
}

export interface RankOptions {
    readonly post: PostFilterOptions;
    readonly sort: ScanSort;
    readonly top?: number;
    readonly perDate?: boolean;
}

/** Apply post-filters, dedupe, then reduce to top-N or cheapest-per-date. */
export function rankHits(hits: readonly ScanHit[], options: RankOptions): ScanHit[] {
    const filters = buildFilters(options.post);
    let kept = hits.filter((h) => applyFilters([h.itinerary], filters).length === 1);

    // Dedupe by (date + orientation + itinerary signature).
    const seen = new Set<string>();
    kept = kept.filter((h) => {
        const merged = dedupeItineraries([h.itinerary]);
        const key = `${h.task.outboundDate}|${h.task.returnDate ?? ""}|${h.task.orientation}|${merged[0]?.price ?? ""}|${h.itinerary.total_duration ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (options.perDate) {
        const cheapestByDate = new Map<string, ScanHit>();
        for (const h of sortHits(kept, "price")) {
            if (!cheapestByDate.has(h.task.outboundDate)) cheapestByDate.set(h.task.outboundDate, h);
        }
        const perDate = sortHits([...cheapestByDate.values()], options.sort);
        return options.top !== undefined ? perDate.slice(0, options.top) : perDate;
    }

    const sorted = sortHits(kept, options.sort);
    return options.top !== undefined ? sorted.slice(0, options.top) : sorted;
}

export function renderScanTable(hits: readonly ScanHit[], currency: string): string {
    if (hits.length === 0) return "No matching flights found across the scanned window.";
    const lines: string[] = [];
    lines.push(`${"DEPART".padEnd(11)} ${"RETURN".padEnd(11)} ${"ORIENTATION".padEnd(20)} PRICE / DETAILS`);
    for (const h of hits) {
        lines.push(
            `${h.task.outboundDate.padEnd(11)} ${(h.task.returnDate ?? "—").padEnd(11)} ${h.task.orientation.padEnd(20)} ${itineraryLine(h.itinerary, currency)}`,
        );
    }
    return lines.join("\n");
}

export function scanHitsToJson(hits: readonly ScanHit[]): unknown[] {
    return hits.map((h) => ({
        outbound_date: h.task.outboundDate,
        return_date: h.task.returnDate ?? null,
        nights: h.task.nights ?? null,
        orientation: h.task.orientation,
        price: h.itinerary.price ?? null,
        stops: stopCount(h.itinerary),
        total_duration: h.itinerary.total_duration ?? null,
        airlines: airlines(h.itinerary),
        route: route(h.itinerary),
        itinerary: h.itinerary,
    }));
}

export function scanHitsToCsv(hits: readonly ScanHit[]): string {
    const header = ["outbound_date", "return_date", "nights", "orientation", "price", "stops", "duration_min", "duration", "airlines", "from", "to"];
    const rows = hits.map((h) => {
        const r = route(h.itinerary);
        return [
            h.task.outboundDate,
            h.task.returnDate ?? "",
            h.task.nights ?? "",
            h.task.orientation,
            h.itinerary.price ?? "",
            stopCount(h.itinerary),
            h.itinerary.total_duration ?? "",
            formatDuration(h.itinerary.total_duration),
            airlines(h.itinerary).join("; "),
            r.from,
            r.to,
        ].map(csvCell);
    });
    return [header.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\n");
}

function csvCell(value: unknown): string {
    const s = String(value ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Human summary of a plan for `--dry-run`. */
export function describePlan(tasks: readonly ScanTask[], maxCredits: number): string {
    const byOrient = new Map<string, number>();
    for (const t of tasks) byOrient.set(t.orientation, (byOrient.get(t.orientation) ?? 0) + 1);
    const lines = [
        `Plan: ${tasks.length} searches (~${tasks.length} SerpAPI credits worst case; cache hits are free).`,
        `Budget: --max-credits ${maxCredits}.`,
        "By orientation:",
        ...[...byOrient.entries()].map(([o, n]) => `  ${o.padEnd(22)} ${n}`),
    ];
    return lines.join("\n");
}
