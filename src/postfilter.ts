/**
 * Client-side filters the SerpAPI Google Flights engine can't express server-side:
 * exact stop counts (the API only does "N or fewer"), a minimum price, total-duration
 * and per-layover caps, and de-duping a fare that appears in both best_ and other_flights.
 */
import type { FlightItinerary } from "./types.ts";
import { stopCount } from "./render.ts";

export type ItineraryFilter = (it: FlightItinerary) => boolean;

export interface PostFilterOptions {
    /** Keep only itineraries with EXACTLY this many stops. */
    readonly exactStops?: number;
    readonly minPrice?: number;
    readonly maxPrice?: number;
    /** Cap total trip duration (minutes). */
    readonly maxTotalDuration?: number;
    /** Cap the longest single layover (minutes). */
    readonly maxLayover?: number;
}

export function buildFilters(options: PostFilterOptions): ItineraryFilter[] {
    const filters: ItineraryFilter[] = [];
    if (options.exactStops !== undefined) {
        const n = options.exactStops;
        filters.push((it) => stopCount(it) === n);
    }
    if (options.minPrice !== undefined) {
        const min = options.minPrice;
        filters.push((it) => it.price !== undefined && it.price >= min);
    }
    if (options.maxPrice !== undefined) {
        const max = options.maxPrice;
        filters.push((it) => it.price !== undefined && it.price <= max);
    }
    if (options.maxTotalDuration !== undefined) {
        const max = options.maxTotalDuration;
        filters.push((it) => it.total_duration !== undefined && it.total_duration <= max);
    }
    if (options.maxLayover !== undefined) {
        const max = options.maxLayover;
        filters.push((it) => (it.layovers ?? []).every((l) => l.duration === undefined || l.duration <= max));
    }
    return filters;
}

export function applyFilters(items: readonly FlightItinerary[], filters: readonly ItineraryFilter[]): FlightItinerary[] {
    return items.filter((it) => filters.every((f) => f(it)));
}

/** A stable-ish signature for an itinerary, used to drop duplicates across best/other. */
export function itinerarySignature(it: FlightItinerary): string {
    const segs = (it.flights ?? [])
        .map((f) => `${f.flight_number ?? f.airline ?? "?"}@${f.departure_airport?.time ?? "?"}`)
        .join("|");
    return `${it.price ?? "?"}#${segs}`;
}

export function dedupeItineraries(items: readonly FlightItinerary[]): FlightItinerary[] {
    const seen = new Set<string>();
    const out: FlightItinerary[] = [];
    for (const it of items) {
        const sig = itinerarySignature(it);
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push(it);
    }
    return out;
}
