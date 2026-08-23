/**
 * TypeScript shapes for the SerpAPI Google Flights engine (`engine=google_flights`).
 *
 * `SerpFlightsQuery` mirrors the documented request parameters one-to-one (snake_case,
 * every value a string because that is how they go on the query string). The response
 * types cover the fields this CLI reads; unknown fields are preserved but untyped.
 *
 * Docs: https://serpapi.com/google-flights-api
 */

/** A single leg of a multi-city (`type=3`) itinerary, encoded into `multi_city_json`. */
export interface MultiCityLeg {
    readonly departure_id: string;
    readonly arrival_id: string;
    readonly date: string;
    /** Optional time window, same format as `outbound_times` ("8,18" or "8,18,9,23"). */
    readonly times?: string;
}

/**
 * Every documented `google_flights` request parameter. All optional except the engine
 * (added by the client). Values are strings so they serialize onto the query string
 * verbatim; enums are the numeric codes SerpAPI expects, as strings.
 */
export interface SerpFlightsQuery {
    // Route
    departure_id?: string;
    arrival_id?: string;
    // Trip type & dates
    type?: "1" | "2" | "3";
    outbound_date?: string;
    return_date?: string;
    multi_city_json?: string;
    // Localization
    gl?: string;
    hl?: string;
    currency?: string;
    // Passengers
    adults?: string;
    children?: string;
    infants_in_seat?: string;
    infants_on_lap?: string;
    // Filters
    travel_class?: "1" | "2" | "3" | "4";
    stops?: "0" | "1" | "2" | "3";
    exclude_airlines?: string;
    include_airlines?: string;
    bags?: string;
    max_price?: string;
    outbound_times?: string;
    return_times?: string;
    emissions?: "1";
    layover_duration?: string;
    exclude_conns?: string;
    max_duration?: string;
    sort_by?: "1" | "2" | "3" | "4" | "5" | "6";
    // Advanced
    show_hidden?: "true" | "false";
    deep_search?: "true" | "false";
    exclude_basic?: "true" | "false";
    selected_flights_json?: string;
    // Pagination tokens
    departure_token?: string;
    booking_token?: string;
    // SerpAPI-level
    no_cache?: "true" | "false";
    async?: "true" | "false";
    zero_trace?: "true" | "false";
    output?: "json" | "html";
    json_restrictor?: string;
}

export interface FlightAirport {
    readonly name?: string;
    readonly id?: string;
    readonly time?: string;
}

/** One physical flight segment within an itinerary. */
export interface FlightSegment {
    readonly departure_airport?: FlightAirport;
    readonly arrival_airport?: FlightAirport;
    readonly duration?: number;
    readonly airplane?: string;
    readonly airline?: string;
    readonly airline_logo?: string;
    readonly travel_class?: string;
    readonly flight_number?: string;
    readonly legroom?: string;
    readonly extensions?: readonly string[];
    readonly overnight?: boolean;
    readonly often_delayed_by_over_30_min?: boolean;
}

export interface Layover {
    readonly duration?: number;
    readonly name?: string;
    readonly id?: string;
    readonly overnight?: boolean;
}

export interface CarbonEmissions {
    readonly this_flight?: number;
    readonly typical_for_this_route?: number;
    readonly difference_percent?: number;
}

/** A priced itinerary (a member of `best_flights` / `other_flights`). */
export interface FlightItinerary {
    readonly flights?: readonly FlightSegment[];
    readonly layovers?: readonly Layover[];
    readonly total_duration?: number;
    readonly carbon_emissions?: CarbonEmissions;
    readonly price?: number;
    readonly type?: string;
    readonly airline_logo?: string;
    readonly extensions?: readonly string[];
    readonly departure_token?: string;
    readonly booking_token?: string;
}

export interface PriceInsights {
    readonly lowest_price?: number;
    readonly price_level?: string;
    readonly typical_price_range?: readonly [number, number];
    readonly price_history?: ReadonlyArray<readonly [number, number]>;
}

export interface SerpFlightsResponse {
    readonly search_metadata?: Record<string, unknown>;
    readonly search_parameters?: Record<string, unknown>;
    readonly best_flights?: readonly FlightItinerary[];
    readonly other_flights?: readonly FlightItinerary[];
    readonly price_insights?: PriceInsights;
    readonly airports?: readonly unknown[];
    readonly booking_options?: readonly unknown[];
    readonly selected_flights?: readonly FlightItinerary[];
    readonly error?: string;
    readonly [key: string]: unknown;
}
