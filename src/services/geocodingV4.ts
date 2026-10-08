/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ExploredLocation,
  GeocodeErrorState,
  GeocodeV4AddressComponent,
  GeocodeV4Response,
  GeocodeV4Result,
  GeocodeV4Viewport,
  NormalizedAddressComponent,
} from '../types/geocoding';

export const GEOCODING_V4_BASE_URL = 'https://geocode.googleapis.com/v4/geocode/address/';

let cachedRuntimeMapsKey = '';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')
    ? 'https://block-explore.onrender.com'
    : '')
).replace(/\/+$/, '');

export async function resolveRuntimeMapsApiKey(providedKey?: string): Promise<string> {
  const trimmedProvided = (providedKey || '').trim();
  if (trimmedProvided) {
    cachedRuntimeMapsKey = trimmedProvided;
    return trimmedProvided;
  }
  if (cachedRuntimeMapsKey) {
    return cachedRuntimeMapsKey;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/maps-config`);
    if (res.ok) {
      const data = (await res.json()) as { apiKey?: string };
      if (data.apiKey && data.apiKey.trim()) {
        cachedRuntimeMapsKey = data.apiKey.trim();
        return cachedRuntimeMapsKey;
      }
    }
  } catch {
    // Ignore network error if /api/maps-config is unreachable on static hosting
  }

  const staticBuildKey = (import.meta.env.VITE_GOOGLE_MAPS_PLATFORM_KEY || '').trim();
  if (staticBuildKey) {
    cachedRuntimeMapsKey = staticBuildKey;
    return cachedRuntimeMapsKey;
  }

  return '';
}

export class GeocodingRequestError extends Error {
  public readonly details: GeocodeErrorState;

  constructor(details: GeocodeErrorState) {
    super(details.message);
    this.name = 'GeocodingRequestError';
    this.details = details;
  }
}

function extractCoordinates(result: GeocodeV4Result): { lat: number; lng: number } | null {
  const loc = result.location ?? result.geometry?.location;
  if (!loc) return null;

  const lat = typeof loc.latitude === 'number' ? loc.latitude : loc.lat;
  const lng = typeof loc.longitude === 'number' ? loc.longitude : loc.lng;

  if (typeof lat === 'number' && !Number.isNaN(lat) && typeof lng === 'number' && !Number.isNaN(lng)) {
    return { lat, lng };
  }
  return null;
}

function extractViewport(
  viewport?: GeocodeV4Viewport
): { south: number; west: number; north: number; east: number } | undefined {
  if (!viewport) return undefined;
  const low = viewport.low ?? viewport.southwest;
  const high = viewport.high ?? viewport.northeast;
  if (!low || !high) return undefined;

  const south = typeof low.latitude === 'number' ? low.latitude : low.lat;
  const west = typeof low.longitude === 'number' ? low.longitude : low.lng;
  const north = typeof high.latitude === 'number' ? high.latitude : high.lat;
  const east = typeof high.longitude === 'number' ? high.longitude : high.lng;

  if (
    typeof south === 'number' &&
    typeof west === 'number' &&
    typeof north === 'number' &&
    typeof east === 'number'
  ) {
    return { south, west, north, east };
  }
  return undefined;
}

function normalizeComponents(
  components?: GeocodeV4AddressComponent[]
): NormalizedAddressComponent[] {
  if (!Array.isArray(components)) return [];
  return components
    .map((c) => ({
      longText: c.longText ?? c.long_name ?? '',
      shortText: c.shortText ?? c.short_name ?? '',
      types: Array.isArray(c.types) ? c.types : [],
    }))
    .filter((c) => Boolean(c.longText || c.shortText));
}

function extractCityAndState(
  components: NormalizedAddressComponent[],
  postalAddress: GeocodeV4Result['postalAddress'],
  formattedAddress: string,
  fallbackQuery: string
): string {
  const findByType = (targetTypes: string[]) =>
    components.find((c) => targetTypes.some((t) => c.types.includes(t)))?.longText;

  const neighborhood = findByType(['neighborhood', 'sublocality_level_1', 'sublocality']);
  const locality =
    findByType(['locality', 'postal_town', 'administrative_area_level_3']) ||
    postalAddress?.locality;
  const state =
    findByType(['administrative_area_level_1', 'administrative_area_level_2']) ||
    postalAddress?.administrativeArea;
  const country = findByType(['country']);

  const primaryPlace = locality || neighborhood;

  if (primaryPlace && state && primaryPlace.toLowerCase() !== state.toLowerCase()) {
    return `${primaryPlace}, ${state}`;
  }
  if (neighborhood && locality && neighborhood.toLowerCase() !== locality.toLowerCase()) {
    return `${neighborhood}, ${locality}`;
  }
  if (primaryPlace && country && primaryPlace.toLowerCase() !== country.toLowerCase()) {
    return `${primaryPlace}, ${country}`;
  }
  if (state && country && state.toLowerCase() !== country.toLowerCase()) {
    return `${state}, ${country}`;
  }

  // Fallback to first two comma-separated segments of formattedAddress
  if (formattedAddress) {
    const parts = formattedAddress
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}, ${parts[1]}`;
    }
    if (parts.length === 1) {
      return parts[0];
    }
  }

  return fallbackQuery.trim();
}

/**
 * Issues a forward geocoding GET request to the Google Geocoding V4 API REST endpoint:
 * https://geocode.googleapis.com/v4/geocode/address/{addressQuery}
 * Reference: https://developers.google.com/maps/documentation/geocoding/geocoding?utm_campaign=gmp_mcp_codeassist_v1_aistudio
 */
export async function geocodeAddressV4(
  rawQuery: string,
  apiKey?: string
): Promise<ExploredLocation> {
  const trimmedQuery = rawQuery.trim();
  const displayEndpoint = `${GEOCODING_V4_BASE_URL}${encodeURIComponent(trimmedQuery)}`;

  if (!trimmedQuery) {
    throw new GeocodingRequestError({
      title: 'Empty Location Query',
      message: 'Please enter a city, neighborhood, landmark, or street address before submitting.',
      status: 'INVALID_INPUT',
      query: rawQuery,
      endpointUrl: GEOCODING_V4_BASE_URL,
      timestamp: new Date().toLocaleTimeString(),
      troubleshootingTips: [
        'Type a specific city or neighborhood (e.g., "Palermo, Buenos Aires" or "Shibuya") in the search bar.',
        'Or click one of the five curated preset buttons below the search field.',
      ],
    });
  }

  const effectiveApiKey = await resolveRuntimeMapsApiKey(apiKey);

  const requestUrl = effectiveApiKey
    ? `${displayEndpoint}?key=${encodeURIComponent(effectiveApiKey)}`
    : displayEndpoint;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-FieldMask': '*',
    'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
  };

  if (effectiveApiKey) {
    headers['X-Goog-Api-Key'] = effectiveApiKey;
  }

  const startTime = performance.now();
  let response: Response;

  try {
    response = await fetch(requestUrl, {
      method: 'GET',
      headers,
    });
  } catch (networkErr) {
    const errMsg =
      networkErr instanceof Error
        ? networkErr.message
        : 'Network request to geocode.googleapis.com failed.';
    throw new GeocodingRequestError({
      title: 'Network or Connection Failure',
      message: `Unable to reach the Google Geocoding V4 endpoint: ${errMsg}`,
      status: 'NETWORK_ERROR',
      query: trimmedQuery,
      endpointUrl: displayEndpoint,
      timestamp: new Date().toLocaleTimeString(),
      troubleshootingTips: [
        'Verify your internet connection and ensure requests to geocode.googleapis.com are not blocked by a firewall or browser extension.',
        'Confirm that CORS headers and HTTP referrer restrictions allow requests from this origin.',
      ],
    });
  }

  const durationMs = Math.round(performance.now() - startTime);

  let data: GeocodeV4Response & GeocodeV4Result;
  try {
    data = await response.json();
  } catch {
    throw new GeocodingRequestError({
      title: `Malformed API Response (HTTP ${response.status})`,
      message: 'The Geocoding V4 endpoint returned a non-JSON payload.',
      code: response.status,
      status: response.statusText || 'PARSE_ERROR',
      query: trimmedQuery,
      endpointUrl: displayEndpoint,
      timestamp: new Date().toLocaleTimeString(),
      troubleshootingTips: [
        'Check the browser network tab for proxy or gateway responses intercepting geocode.googleapis.com.',
      ],
    });
  }

  if (!response.ok || data.error) {
    const apiError = data.error;
    const code = apiError?.code ?? response.status;
    const status = apiError?.status ?? data.status ?? (response.statusText || 'API_ERROR');
    const errorInfoDetail = apiError?.details?.find(
      (d) => typeof d.reason === 'string'
    ) as { reason?: string } | undefined;
    const reason = errorInfoDetail?.reason;

    const rawMessage =
      apiError?.message ??
      data.error_message ??
      `Geocoding V4 request failed with HTTP status ${response.status}.`;

    const tips: string[] = [];
    if (!effectiveApiKey) {
      tips.push(
        'No Google Maps API key was detected in GOOGLE_MAPS_PLATFORM_KEY. Configure a valid key in your environment secrets.'
      );
    }
    if (reason === 'API_KEY_INVALID' || code === 400 || code === 403 || status === 'PERMISSION_DENIED') {
      tips.push(
        'Verify that your Google Maps Platform API key is valid and has the "Geocoding API" enabled in Google Cloud Console.'
      );
      tips.push(
        'Check if your API key has HTTP referrer or API restrictions blocking https://geocode.googleapis.com/v4/geocode/address/.'
      );
    } else if (code === 429 || status === 'RESOURCE_EXHAUSTED' || status === 'OVER_QUERY_LIMIT') {
      tips.push(
        'Your project has exceeded its Geocoding API rate limit or daily quota. Wait a moment or review your Google Cloud billing and quota settings.'
      );
    } else {
      tips.push(
        'Ensure the location query is a valid street address, neighborhood, or locality rather than coordinates or non-geospatial text.'
      );
      tips.push(
        'Verify that both Maps JavaScript API and Geocoding API are enabled on your Google Cloud project.'
      );
    }

    throw new GeocodingRequestError({
      title: !effectiveApiKey
        ? 'Missing Google Maps API Key'
        : `Geocoding V4 Error (${status})`,
      message: rawMessage,
      code,
      status,
      reason,
      query: trimmedQuery,
      endpointUrl: displayEndpoint,
      timestamp: new Date().toLocaleTimeString(),
      troubleshootingTips: tips,
    });
  }

  const firstResult: GeocodeV4Result | undefined = Array.isArray(data.results)
    ? data.results[0]
    : data.location || data.geometry
      ? data
      : undefined;

  if (!firstResult) {
    throw new GeocodingRequestError({
      title: 'No Geospatial Match Found (ZERO_RESULTS)',
      message: `The Google Geocoding V4 API returned no matching results for "${trimmedQuery}".`,
      code: 200,
      status: 'ZERO_RESULTS',
      query: trimmedQuery,
      endpointUrl: displayEndpoint,
      timestamp: new Date().toLocaleTimeString(),
      troubleshootingTips: [
        'Check the spelling of the city, neighborhood, or street name.',
        'Include a broader administrative region or country (for example, "Palermo, Buenos Aires" or "Ehrenfeld, Cologne").',
        'Avoid entering raw latitude/longitude coordinates or non-geographic questions.',
      ],
    });
  }

  const coords = extractCoordinates(firstResult);
  if (!coords) {
    throw new GeocodingRequestError({
      title: 'Incomplete Geocode Geometry',
      message: `A match was found for "${trimmedQuery}", but no latitude/longitude coordinates were present in the response.`,
      code: 200,
      status: 'MISSING_GEOMETRY',
      query: trimmedQuery,
      endpointUrl: displayEndpoint,
      timestamp: new Date().toLocaleTimeString(),
      troubleshootingTips: [
        'Ensure the X-Goog-FieldMask header includes location or "*" so coordinates are returned.',
      ],
    });
  }

  const formattedAddress =
    firstResult.formattedAddress ?? firstResult.formatted_address ?? trimmedQuery;
  const granularity =
    firstResult.granularity ?? firstResult.geometry?.location_type ?? 'APPROXIMATE';
  const placeId =
    firstResult.placeId ??
    firstResult.place_id ??
    (firstResult.place ? firstResult.place.replace(/^places\//, '') : 'N/A');
  const types = Array.isArray(firstResult.types) && firstResult.types.length > 0
    ? firstResult.types
    : ['locality'];
  const plusCode =
    firstResult.plusCode?.globalCode ??
    firstResult.plusCode?.compoundCode ??
    firstResult.plus_code?.global_code;
  const regionCode = firstResult.postalAddress?.regionCode;
  const viewport = extractViewport(
    firstResult.viewport ?? firstResult.bounds ?? firstResult.geometry?.viewport
  );
  const addressComponents = normalizeComponents(
    firstResult.addressComponents ?? firstResult.address_components
  );
  const cityAndState = extractCityAndState(
    addressComponents,
    firstResult.postalAddress,
    formattedAddress,
    trimmedQuery
  );

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    query: trimmedQuery,
    cityAndState,
    formattedAddress,
    coordinates: coords,
    rawLatitude: coords.lat,
    rawLongitude: coords.lng,
    granularity,
    placeId,
    types,
    plusCode,
    regionCode,
    viewport,
    addressComponents,
    timestamp: new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    durationMs,
    endpointUrl: displayEndpoint,
  };
}
