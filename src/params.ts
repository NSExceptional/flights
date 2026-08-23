/**
 * The lever registry: one entry per documented SerpAPI Google Flights request
 * parameter, exposed as a friendly CLI flag. This single source of truth drives
 * `node:util` argument parsing, request construction, and `--help`, so "a lever for
 * every documented option" is verifiable by reading one list.
 *
 * Docs: https://serpapi.com/google-flights-api
 */
import type { MultiCityLeg, SerpFlightsQuery } from "./types.ts";

export type FlagKind = "string" | "int" | "bool" | "enum";

export interface FlagSpec {
    /** Long flag name (without leading `--`). */
    readonly flag: string;
    /** The SerpAPI query parameter this sets, or a `special:` marker handled in code. */
    readonly param: keyof SerpFlightsQuery | `special:${string}`;
    readonly kind: FlagKind;
    readonly group: string;
    readonly help: string;
    readonly valueHint?: string;
    /** friendly-value -> SerpAPI code, for `kind: "enum"`. */
    readonly enumMap?: Readonly<Record<string, string>>;
    /** For `kind: "bool"`, the string the API wants when the flag is set (default "true"). */
    readonly boolValue?: string;
    /** Repeatable flag (collected into an array). */
    readonly multiple?: boolean;
}

export const TYPE_MAP = { round: "1", oneway: "2", multi: "3" } as const;
export const CLASS_MAP = { economy: "1", premium: "2", business: "3", first: "4" } as const;
/** Friendly stop ceilings. The API's `stops` is "N or fewer": 0=any,1=nonstop,2=<=1,3=<=2. */
export const STOPS_MAP = { any: "0", nonstop: "1", "1": "2", "2": "3" } as const;
export const SORT_MAP = {
    top: "1",
    price: "2",
    departure: "3",
    arrival: "4",
    duration: "5",
    emissions: "6",
} as const;
export const OUTPUT_MAP = { json: "json", html: "html" } as const;

/** Every documented request lever, grouped for help output. */
export const FLAG_SPECS: readonly FlagSpec[] = [
    // Route & trip type
    { flag: "from", param: "departure_id", kind: "string", group: "Route & trip", valueHint: "IDS", help: "Departure airport(s)/city kgmid. Comma-separated = OR (e.g. CDG,ORY)." },
    { flag: "to", param: "arrival_id", kind: "string", group: "Route & trip", valueHint: "IDS", help: "Arrival airport(s)/city kgmid. Comma-separated = OR (e.g. MXP,BGY,LIN)." },
    { flag: "type", param: "type", kind: "enum", enumMap: TYPE_MAP, group: "Route & trip", valueHint: "round|oneway|multi", help: "Trip shape (default round). `multi` requires --leg." },
    { flag: "depart", param: "outbound_date", kind: "string", group: "Route & trip", valueHint: "YYYY-MM-DD", help: "Outbound date." },
    { flag: "return", param: "return_date", kind: "string", group: "Route & trip", valueHint: "YYYY-MM-DD", help: "Return date (round trip only)." },
    { flag: "leg", param: "special:leg", kind: "string", multiple: true, group: "Route & trip", valueHint: "FROM:TO:DATE[:TIMES]", help: "Multi-city leg (repeatable). Sets --type multi. e.g. CDG:NRT:2026-08-29." },

    // Passengers
    { flag: "adults", param: "adults", kind: "int", group: "Passengers", valueHint: "N", help: "Adults (default 1)." },
    { flag: "children", param: "children", kind: "int", group: "Passengers", valueHint: "N", help: "Children." },
    { flag: "infants-in-seat", param: "infants_in_seat", kind: "int", group: "Passengers", valueHint: "N", help: "Infants in seat." },
    { flag: "infants-on-lap", param: "infants_on_lap", kind: "int", group: "Passengers", valueHint: "N", help: "Infants on lap." },

    // Filters
    { flag: "class", param: "travel_class", kind: "enum", enumMap: CLASS_MAP, group: "Filters", valueHint: "economy|premium|business|first", help: "Cabin class (default economy)." },
    { flag: "max-stops", param: "stops", kind: "enum", enumMap: STOPS_MAP, group: "Filters", valueHint: "any|nonstop|1|2", help: "Stop ceiling: nonstop / 1-or-fewer / 2-or-fewer (default any)." },
    { flag: "include-airlines", param: "include_airlines", kind: "string", group: "Filters", valueHint: "CODES", help: "Only these airlines/alliances (IATA 2-char or STAR_ALLIANCE/SKYTEAM/ONEWORLD)." },
    { flag: "exclude-airlines", param: "exclude_airlines", kind: "string", group: "Filters", valueHint: "CODES", help: "Exclude these airlines/alliances. Mutually exclusive with --include-airlines." },
    { flag: "bags", param: "bags", kind: "int", group: "Filters", valueHint: "N", help: "Carry-on bags." },
    { flag: "max-price", param: "max_price", kind: "int", group: "Filters", valueHint: "N", help: "Max ticket price (in --currency)." },
    { flag: "depart-times", param: "outbound_times", kind: "string", group: "Filters", valueHint: "H,H[,H,H]", help: "Outbound time window by hour (e.g. 4,18 depart; 4,18,3,19 depart+arrive)." },
    { flag: "return-times", param: "return_times", kind: "string", group: "Filters", valueHint: "H,H[,H,H]", help: "Return time window (round trip only)." },
    { flag: "less-emissions", param: "emissions", kind: "bool", boolValue: "1", group: "Filters", help: "Only lower-emission flights." },
    { flag: "layover-duration", param: "layover_duration", kind: "string", group: "Filters", valueHint: "MIN,MAX", help: "Layover length window in minutes (e.g. 90,330)." },
    { flag: "exclude-conns", param: "exclude_conns", kind: "string", group: "Filters", valueHint: "CODES", help: "Exclude these connecting airports (e.g. CDG,LHR)." },
    { flag: "max-duration", param: "max_duration", kind: "int", group: "Filters", valueHint: "MIN", help: "Max total trip duration in minutes." },
    { flag: "sort", param: "sort_by", kind: "enum", enumMap: SORT_MAP, group: "Filters", valueHint: "top|price|departure|arrival|duration|emissions", help: "Server-side sort (default top)." },

    // Localization
    { flag: "gl", param: "gl", kind: "string", group: "Localization", valueHint: "CC", help: "Country code (e.g. us)." },
    { flag: "hl", param: "hl", kind: "string", group: "Localization", valueHint: "LL", help: "Language code (e.g. en)." },
    { flag: "currency", param: "currency", kind: "string", group: "Localization", valueHint: "CUR", help: "Currency (default USD)." },

    // Advanced
    { flag: "show-hidden", param: "show_hidden", kind: "bool", group: "Advanced", help: "Include hidden ('view more flights') results." },
    { flag: "deep", param: "deep_search", kind: "bool", group: "Advanced", help: "Deep search: matches the live UI better, slower." },
    { flag: "exclude-basic", param: "exclude_basic", kind: "bool", group: "Advanced", help: "Exclude US basic-economy fares." },
    { flag: "selected-flights-json", param: "selected_flights_json", kind: "string", group: "Advanced", valueHint: "JSON", help: "Pin an exact itinerary (raw selected_flights_json passthrough)." },
    { flag: "departure-token", param: "departure_token", kind: "string", group: "Advanced", valueHint: "TOKEN", help: "Select an outbound flight to fetch its return/next-leg options." },
    { flag: "booking-token", param: "booking_token", kind: "string", group: "Advanced", valueHint: "TOKEN", help: "Fetch booking options for a chosen itinerary." },
    { flag: "no-cache", param: "no_cache", kind: "bool", group: "Advanced", help: "Force a fresh (billed) fetch, ignoring SerpAPI's ~1h cache." },
    { flag: "async", param: "async", kind: "bool", group: "Advanced", help: "Submit asynchronously (retrieve later from the Searches Archive)." },
    { flag: "zero-trace", param: "zero_trace", kind: "bool", group: "Advanced", help: "Enterprise zero-trace mode." },
    { flag: "serp-output", param: "output", kind: "enum", enumMap: OUTPUT_MAP, group: "Advanced", valueHint: "json|html", help: "SerpAPI response format. html is printed raw." },
    { flag: "json-restrictor", param: "json_restrictor", kind: "string", group: "Advanced", valueHint: "SPEC", help: "Trim the response to selected fields." },
];

/** Build a `node:util` parseArgs options config from the registry (plus extras). */
export function buildParseArgsOptions(
    specs: readonly FlagSpec[],
    extras: Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }> = {},
): Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }> {
    const options: Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }> = {
        ...extras,
    };
    for (const spec of specs) {
        options[spec.flag] = { type: spec.kind === "bool" ? "boolean" : "string", ...(spec.multiple ? { multiple: true } : {}) };
    }
    return options;
}

/** Thrown for user-facing validation problems (bad enum value, conflicting flags, etc.). */
export class FlagError extends Error {}

function parseLeg(raw: string): MultiCityLeg {
    // FROM:TO:DATE[:TIMES] — TO may itself contain commas (multi-airport), so split on ":".
    const parts = raw.split(":");
    if (parts.length < 3 || parts.length > 4) {
        throw new FlagError(`--leg must be FROM:TO:DATE[:TIMES], got "${raw}"`);
    }
    const [departure_id, arrival_id, date, times] = parts as [string, string, string, string?];
    if (!departure_id || !arrival_id || !date) {
        throw new FlagError(`--leg has an empty field: "${raw}"`);
    }
    return { departure_id, arrival_id, date, ...(times ? { times } : {}) };
}

function coerceInt(flag: string, value: string): string {
    if (!/^\d+$/.test(value)) throw new FlagError(`--${flag} expects a non-negative integer, got "${value}"`);
    return value;
}

/**
 * Turn parsed flag values into a validated `SerpFlightsQuery`. Applies enum mapping,
 * integer coercion, multi-city leg assembly, and the documented mutual-exclusion /
 * trip-type rules so we fail loudly instead of letting SerpAPI silently misbehave.
 */
export function buildQuery(values: Record<string, unknown>): SerpFlightsQuery {
    const query: SerpFlightsQuery = {};

    for (const spec of FLAG_SPECS) {
        const raw = values[spec.flag];
        if (raw === undefined) continue;
        if (spec.param === "special:leg") continue; // handled below

        const key = spec.param as keyof SerpFlightsQuery;
        if (spec.kind === "bool") {
            if (raw === true) (query as Record<string, string>)[key] = spec.boolValue ?? "true";
        } else if (spec.kind === "enum") {
            const mapped = spec.enumMap?.[String(raw)];
            if (mapped === undefined) {
                const allowed = Object.keys(spec.enumMap ?? {}).join("|");
                throw new FlagError(`--${spec.flag} must be one of ${allowed}, got "${String(raw)}"`);
            }
            (query as Record<string, string>)[key] = mapped;
        } else if (spec.kind === "int") {
            (query as Record<string, string>)[key] = coerceInt(spec.flag, String(raw));
        } else {
            (query as Record<string, string>)[key] = String(raw);
        }
    }

    // Multi-city legs -> multi_city_json. `--leg` implies (and requires) type=3;
    // an explicit non-multi --type alongside it is a conflict, not a silent override.
    const legRaw = values["leg"];
    const legs = Array.isArray(legRaw) ? legRaw.map((l) => parseLeg(String(l))) : legRaw !== undefined ? [parseLeg(String(legRaw))] : [];
    if (legs.length > 0) {
        if (query.type !== undefined && query.type !== "3") {
            throw new FlagError("--leg is only valid with --type multi.");
        }
        query.multi_city_json = JSON.stringify(legs);
        query.type = "3";
    }

    validateQuery(query, legs.length);
    return query;
}

/** Enforce the documented parameter interactions before spending a request. */
export function validateQuery(query: SerpFlightsQuery, legCount: number): void {
    if (query.include_airlines && query.exclude_airlines) {
        throw new FlagError("--include-airlines and --exclude-airlines are mutually exclusive.");
    }
    if (query.departure_token && query.booking_token) {
        throw new FlagError("--departure-token and --booking-token are mutually exclusive.");
    }
    if (query.no_cache === "true" && query.async === "true") {
        throw new FlagError("--no-cache and --async are mutually exclusive.");
    }
    if (query.type === "3") {
        if (legCount === 0) throw new FlagError("--type multi requires at least one --leg.");
    } else if (legCount > 0) {
        throw new FlagError("--leg is only valid with --type multi.");
    }
    // return_date / return_times are round-trip-only (invalid for one-way AND multi-city).
    if (query.type && query.type !== "1" && query.return_date) {
        throw new FlagError("--return is only valid for a round trip.");
    }
    if (query.type && query.type !== "1" && query.return_times) {
        throw new FlagError("--return-times is only valid for a round trip.");
    }
}

/** Render the grouped `--help` body for the request levers. */
export function renderFlagHelp(specs: readonly FlagSpec[]): string {
    const groups = new Map<string, FlagSpec[]>();
    for (const spec of specs) {
        const list = groups.get(spec.group) ?? [];
        list.push(spec);
        groups.set(spec.group, list);
    }
    const lines: string[] = [];
    for (const [group, list] of groups) {
        lines.push(`  ${group}:`);
        for (const spec of list) {
            const invocation = `--${spec.flag}${spec.valueHint ? " " + spec.valueHint : ""}`;
            lines.push(`    ${invocation.padEnd(34)} ${spec.help}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
