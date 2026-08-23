/**
 * Human-readable rendering of flight results. `json`/`csv` output is produced by the
 * commands themselves; this module owns the `table` summaries and shared formatters.
 */
import type { FlightItinerary, SerpFlightsResponse } from "./types.ts";

export function formatDuration(minutes: number | undefined): string {
    if (minutes === undefined || !Number.isFinite(minutes)) return "?";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
}

export function formatPrice(price: number | undefined, currency = "USD"): string {
    if (price === undefined || !Number.isFinite(price)) return "—";
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(price);
    } catch {
        return `${price} ${currency}`;
    }
}

/** Merge best_flights + other_flights (best first), preserving order. */
export function collectItineraries(response: SerpFlightsResponse): FlightItinerary[] {
    return [...(response.best_flights ?? []), ...(response.other_flights ?? [])];
}

/** Number of stops for an itinerary (segments - 1, or layover count). */
export function stopCount(it: FlightItinerary): number {
    if (it.layovers) return it.layovers.length;
    if (it.flights) return Math.max(0, it.flights.length - 1);
    return 0;
}

/** Distinct operating airlines across an itinerary's segments. */
export function airlines(it: FlightItinerary): string[] {
    const names = (it.flights ?? []).map((f) => f.airline).filter((a): a is string => Boolean(a));
    return [...new Set(names)];
}

/** Origin/destination airport ids for the whole itinerary. */
export function route(it: FlightItinerary): { from: string; to: string } {
    const segs = it.flights ?? [];
    return {
        from: segs[0]?.departure_airport?.id ?? "?",
        to: segs[segs.length - 1]?.arrival_airport?.id ?? "?",
    };
}

function stopsLabel(n: number): string {
    return n === 0 ? "nonstop" : n === 1 ? "1 stop" : `${n} stops`;
}

/** One compact line describing an itinerary. */
export function itineraryLine(it: FlightItinerary, currency: string): string {
    const { from, to } = route(it);
    const layoverIds = (it.layovers ?? []).map((l) => l.id).filter(Boolean).join(",");
    const via = layoverIds ? ` via ${layoverIds}` : "";
    return [
        formatPrice(it.price, currency).padStart(8),
        `${from}→${to}`.padEnd(9),
        stopsLabel(stopCount(it)).padEnd(8),
        formatDuration(it.total_duration).padEnd(9),
        airlines(it).join(", ") + via,
    ].join("  ");
}

/** Full table for a single `search` response. */
export function renderSearchTable(response: SerpFlightsResponse, currency: string): string {
    const items = collectItineraries(response);
    if (items.length === 0) return "No flights found.";

    const lines: string[] = [];
    const insights = response.price_insights;
    if (insights?.lowest_price !== undefined || insights?.price_level) {
        const level = insights.price_level ? ` (${insights.price_level})` : "";
        const range = insights.typical_price_range
            ? `, typical ${formatPrice(insights.typical_price_range[0], currency)}–${formatPrice(insights.typical_price_range[1], currency)}`
            : "";
        lines.push(`Price insight: lowest ${formatPrice(insights.lowest_price, currency)}${level}${range}`);
        lines.push("");
    }

    const nBest = response.best_flights?.length ?? 0;
    items.forEach((it, i) => {
        if (nBest > 0 && i === 0) lines.push("Best:");
        if (nBest > 0 && i === nBest) lines.push("Other:");
        lines.push(`  ${itineraryLine(it, currency)}`);
    });
    lines.push("");
    lines.push(`${items.length} itineraries.`);
    return lines.join("\n");
}
