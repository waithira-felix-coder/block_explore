/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  AlertCircle,
  ArrowUpRight,
  Bookmark,
  Check,
  Copy,
  MapPin,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import InteractiveMapCanvas from './components/InteractiveMapCanvas';
import {
  GEOCODING_V4_BASE_URL,
  geocodeAddressV4,
  GeocodingRequestError,
} from './services/geocodingV4';
import { fetchLocalInsights } from './services/localInsights';
import {
  ExploredLocation,
  GeocodeErrorState,
  PRESET_DESTINATIONS,
} from './types/geocoding';

const API_KEY: string =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || '';

const SAVED_LOCATIONS_STORAGE_KEY = 'block_explorer_saved_locations_v1';
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 consecutive calendar days per GMP ToS

interface StoredBookmark extends ExploredLocation {
  savedAtMs?: number;
}

function loadSavedLocationsFromStorage(): StoredBookmark[] {
  try {
    const raw = window.localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((item: StoredBookmark) => {
      if (!item || typeof item.formattedAddress !== 'string' || !item.coordinates) {
        return false;
      }
      if (typeof item.savedAtMs === 'number' && now - item.savedAtMs > MAX_CACHE_AGE_MS) {
        return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activePreset, setActivePreset] = useState<string>('Buenos Aires');
  const [selectedLocation, setSelectedLocation] = useState<ExploredLocation | null>(null);
  const [savedLocations, setSavedLocations] = useState<StoredBookmark[]>(() =>
    loadSavedLocationsFromStorage()
  );
  const [history, setHistory] = useState<ExploredLocation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorState, setErrorState] = useState<GeocodeErrorState | null>(null);
  const [panTrigger, setPanTrigger] = useState<number>(0);
  const [copiedCoords, setCopiedCoords] = useState<boolean>(false);
  const [currentZoom, setCurrentZoom] = useState<number>(3);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVED_LOCATIONS_STORAGE_KEY,
        JSON.stringify(savedLocations)
      );
    } catch {
      // Ignore storage quota or private mode restrictions
    }
  }, [savedLocations]);

  // Local Insights AI State (gemini-3.8-flash)
  const [insightsCityAndState, setInsightsCityAndState] = useState<string>('');
  const [insightsHtml, setInsightsHtml] = useState<string | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState<boolean>(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const insightsAbortControllerRef = useRef<AbortController | null>(null);

  const loadLocalInsights = useCallback(async (cityAndState: string) => {
    const cleanPlace = cityAndState.trim();
    if (!cleanPlace) return;

    if (insightsAbortControllerRef.current) {
      insightsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    insightsAbortControllerRef.current = controller;

    setInsightsCityAndState(cleanPlace);
    setIsLoadingInsights(true);
    setInsightsError(null);

    try {
      const result = await fetchLocalInsights(cleanPlace, controller.signal);
      if (!controller.signal.aborted) {
        setInsightsHtml(result.html);
        setInsightsCityAndState(result.cityAndState);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (!controller.signal.aborted) {
        setInsightsHtml(null);
        setInsightsError(
          err instanceof Error
            ? err.message
            : `Failed to generate Local Insights for ${cleanPlace}.`
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoadingInsights(false);
      }
    }
  }, []);

  const executeGeocode = useCallback(
    async (locationQuery: string) => {
      setIsLoading(true);
      setErrorState(null);

      try {
        const resolved = await geocodeAddressV4(locationQuery, API_KEY);
        setSelectedLocation(resolved);
        setPanTrigger((prev) => prev + 1);
        setHistory((prev) => {
          const filtered = prev.filter(
            (item) =>
              item.query.toLowerCase() !== resolved.query.toLowerCase() &&
              item.formattedAddress !== resolved.formattedAddress
          );
          return [resolved, ...filtered].slice(0, 6);
        });

        // Once geocoding successfully identifies the City and State, trigger Gemini API call
        loadLocalInsights(resolved.cityAndState);
      } catch (err) {
        if (err instanceof GeocodingRequestError) {
          setErrorState(err.details);
        } else {
          setErrorState({
            title: 'Unexpected Geocoding Error',
            message:
              err instanceof Error
                ? err.message
                : 'An unknown error occurred while geocoding the location.',
            status: 'UNKNOWN_ERROR',
            query: locationQuery,
            endpointUrl: `${GEOCODING_V4_BASE_URL}${encodeURIComponent(locationQuery.trim())}`,
            timestamp: new Date().toLocaleTimeString(),
            troubleshootingTips: [
              'Verify that your Google Maps Platform API key is active and has Geocoding API enabled.',
              'Try searching for a well-known city or clicking one of the preset buttons.',
            ],
          });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [loadLocalInsights]
  );

  // Automatically geocode the first preset ("Buenos Aires") on initial mount
  useEffect(() => {
    executeGeocode('Buenos Aires');
    return () => {
      insightsAbortControllerRef.current?.abort();
    };
  }, [executeGeocode]);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const matchedPreset = PRESET_DESTINATIONS.find(
      (p) => p.name.toLowerCase() === searchQuery.trim().toLowerCase()
    );
    setActivePreset(matchedPreset ? matchedPreset.name : '');
    executeGeocode(searchQuery);
  };

  const handlePresetClick = (presetName: string) => {
    setActivePreset(presetName);
    executeGeocode(presetName);
  };

  const handleSelectHistoryItem = (item: ExploredLocation) => {
    setSearchQuery(item.query);
    setSelectedLocation(item);
    setErrorState(null);
    setPanTrigger((prev) => prev + 1);
    loadLocalInsights(item.cityAndState);
  };

  const isCurrentLocationBookmarked = Boolean(
    selectedLocation &&
      savedLocations.some(
        (item) =>
          item.formattedAddress === selectedLocation.formattedAddress ||
          (item.rawLatitude === selectedLocation.rawLatitude &&
            item.rawLongitude === selectedLocation.rawLongitude)
      )
  );

  const handleBookmarkLocation = () => {
    if (!selectedLocation) return;

    setSavedLocations((prev) => {
      const exists = prev.some(
        (item) =>
          item.formattedAddress === selectedLocation.formattedAddress ||
          (item.rawLatitude === selectedLocation.rawLatitude &&
            item.rawLongitude === selectedLocation.rawLongitude)
      );
      if (exists) {
        return prev;
      }
      const bookmarkedEntry: StoredBookmark = {
        ...selectedLocation,
        savedAtMs: Date.now(),
      };
      return [bookmarkedEntry, ...prev];
    });
  };

  const handleRemoveBookmark = (idToRemove: string, formattedAddress: string) => {
    setSavedLocations((prev) =>
      prev.filter(
        (item) => item.id !== idToRemove && item.formattedAddress !== formattedAddress
      )
    );
  };

  const handleCopyCoordinates = async () => {
    if (!selectedLocation) return;
    const text = `${selectedLocation.rawLatitude}, ${selectedLocation.rawLongitude}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 2000);
    } catch {
      // Clipboard API fallback not needed if restricted
    }
  };

  const handleMapSdkError = useCallback((sdkMessage: string) => {
    setErrorState((prev) => {
      if (prev) return prev;
      return {
        title: 'Google Maps SDK Configuration Issue',
        message: sdkMessage,
        status: 'SDK_AUTH_ERROR',
        query: 'Map Initialization',
        endpointUrl: GEOCODING_V4_BASE_URL,
        timestamp: new Date().toLocaleTimeString(),
        troubleshootingTips: [
          'Ensure VITE_GOOGLE_MAPS_API_KEY is set to a valid Google Maps Platform API key.',
          'Enable both "Maps JavaScript API" and "Geocoding API" in your Google Cloud project.',
        ],
      };
    });
  }, []);

  return (
    <APIProvider apiKey={API_KEY} libraries={['marker']}>
      <div className="min-h-screen w-full flex flex-col lg:flex-row bg-[#FBF9F5] text-[#1C1917]">
        {/* Left-Side 1/3-Width Editorial Control Panel */}
        <aside className="w-full lg:w-1/3 lg:h-screen lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-stone-300 bg-[#FBF9F5] flex flex-col justify-between">
          <div className="p-6 sm:p-8 lg:p-9 space-y-7">
            {/* Editorial Masthead */}
            <header className="border-b border-stone-300 pb-6">
              <div className="flex items-center justify-between text-xs uppercase tracking-widest text-stone-500 mb-2">
                <span>Geospatial Gazetteer</span>
                <span> · </span>
                <span className="font-mono-tabular">
                  Zoom Level: {currentZoom.toFixed(1)}
                </span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-editorial font-normal tracking-tight text-stone-900 leading-none">
                Block Explorer
              </h1>
              <p className="mt-3 text-sm text-stone-600 leading-relaxed max-w-prose">
                Survey urban morphology, neighborhood coordinates, and local tour
                guide insights across the globe via Google Geocoding V4 and Gemini.
              </p>
            </header>

            {/* Search Bar Form */}
            <section aria-label="Location Search">
              <form onSubmit={handleSearchSubmit} className="space-y-2.5" noValidate>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="location-search-input"
                    className="text-xs uppercase tracking-widest text-stone-600 font-medium"
                  >
                    01. Search Location or Neighborhood
                  </label>
                  <span className="text-[11px] font-mono-tabular text-stone-500">
                    /v4/geocode/address/
                  </span>
                </div>

                <div className="relative flex items-stretch">
                  <div className="relative flex-1">
                    <Search
                      className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      id="location-search-input"
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Enter a city, neighborhood, or street..."
                      aria-label="Search location or neighborhood"
                      className="w-full pl-10 pr-8 py-2.5 bg-white border border-stone-300 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-[#9A3412] focus:ring-1 focus:ring-[#9A3412] transition-colors"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear search query"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-0.5 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="px-5 py-2.5 bg-[#1C1917] hover:bg-[#292524] disabled:bg-stone-400 text-[#FBF9F5] text-xs font-medium tracking-wide uppercase transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Geocoding</span>
                      </>
                    ) : (
                      <span>Explore</span>
                    )}
                  </button>
                </div>
              </form>
            </section>

            {/* Five Curated Preset Buttons */}
            <section aria-label="Curated Location Presets" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-widest text-stone-600 font-sans font-medium">
                  02. Curated Urban Presets
                </h2>
                <span className="text-xs text-stone-500">
                  5 Global Districts
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                {PRESET_DESTINATIONS.map((preset) => {
                  const isSelected =
                    activePreset.toLowerCase() === preset.name.toLowerCase();
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      disabled={isLoading}
                      onClick={() => handlePresetClick(preset.name)}
                      className={`group text-left px-3.5 py-2.5 border transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-[#1C1917] text-[#FBF9F5] border-[#1C1917]'
                          : 'bg-[#F7F4EE] hover:bg-[#EBE6DF] text-stone-900 border-stone-300'
                      }`}
                    >
                      <span className="text-xs font-semibold tracking-tight whitespace-nowrap truncate">
                        {preset.name}
                      </span>
                      <ArrowUpRight
                        aria-hidden="true"
                        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${
                          isSelected ? 'text-[#C2410C]' : 'text-stone-400'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Clear Error Message & Troubleshooting Mechanism */}
            {errorState && (
              <section
                role="alert"
                aria-live="assertive"
                className="border border-red-800/40 bg-red-50/70 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-800 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-red-950">
                        {errorState.title}
                      </h3>
                      <p className="text-xs text-red-900 mt-1 leading-relaxed">
                        {errorState.message}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorState(null)}
                    aria-label="Dismiss error message"
                    className="text-red-800 hover:text-red-950 p-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Diagnostic Metadata */}
                <div className="border-t border-red-800/20 pt-2.5 text-[11px] font-mono-tabular text-red-900/90 space-y-1 break-all">
                  <div>
                    <span className="text-red-700">Endpoint: </span>
                    {errorState.endpointUrl}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2">
                    {errorState.code && (
                      <span>Code: {errorState.code}</span>
                    )}
                    {errorState.status && (
                      <>
                        <span>·</span>
                        <span>Status: {errorState.status}</span>
                      </>
                    )}
                    {errorState.reason && (
                      <>
                        <span>·</span>
                        <span>Reason: {errorState.reason}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Troubleshooting Guide */}
                {errorState.troubleshootingTips.length > 0 && (
                  <div className="border-t border-red-800/20 pt-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-red-950 mb-1.5">
                      Troubleshooting Steps
                    </div>
                    <ul className="space-y-1 text-xs text-red-900 list-disc list-inside leading-relaxed">
                      {errorState.troubleshootingTips.map((tip, idx) => (
                        <li key={idx}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => executeGeocode(errorState.query || searchQuery)}
                    className="px-3 py-1.5 bg-red-900 hover:bg-red-950 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry Geocode Request</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setErrorState(null)}
                    className="px-3 py-1.5 border border-red-800/30 hover:bg-red-100/60 text-red-900 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </section>
            )}

            {/* Active Geocoded Location Dossier */}
            <section
              aria-label="Geocoded Location Dossier"
              className="border-t border-stone-300 pt-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-widest text-stone-600 font-sans font-medium">
                  03. Geocoded Block Dossier
                </h2>
                {selectedLocation && (
                  <span className="text-xs font-mono-tabular text-stone-500">
                    {selectedLocation.durationMs} ms · {selectedLocation.timestamp}
                  </span>
                )}
              </div>

              {selectedLocation ? (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-[#9A3412] font-medium flex items-center gap-1.5 mb-1">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {selectedLocation.cityAndState}
                          {' · '}
                          {selectedLocation.types.slice(0, 2).join(' · ')}
                        </span>
                      </div>
                      <h3 className="text-2xl font-editorial text-stone-900 leading-snug">
                        {selectedLocation.formattedAddress}
                      </h3>
                      <div className="text-xs text-stone-500 mt-1">
                        Google Maps
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleBookmarkLocation}
                      aria-label="Bookmark"
                      title={
                        isCurrentLocationBookmarked
                          ? 'Location saved to bookmarks'
                          : 'Bookmark this location'
                      }
                      className={`px-3 py-1.5 border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isCurrentLocationBookmarked
                          ? 'bg-[#1C1917] text-[#FBF9F5] border-[#1C1917]'
                          : 'bg-[#F7F4EE] hover:bg-[#EBE6DF] text-stone-900 border-stone-300'
                      }`}
                    >
                      <Bookmark
                        className={`w-3.5 h-3.5 ${
                          isCurrentLocationBookmarked
                            ? 'fill-[#C2410C] text-[#C2410C]'
                            : 'text-[#9A3412]'
                        }`}
                      />
                      <span>Bookmark</span>
                    </button>
                  </div>

                  {/* Accession Metadata Definition List */}
                  <dl className="border-t border-stone-300 divide-y divide-stone-200 text-xs">
                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <dt className="text-stone-500">Identified Locality</dt>
                      <dd className="font-medium text-stone-900">
                        {selectedLocation.cityAndState}
                      </dd>
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <dt className="text-stone-500">Coordinates (Lat, Lng)</dt>
                      <dd className="font-mono-tabular text-stone-900 font-medium flex items-center gap-2">
                        <span>
                          {selectedLocation.rawLatitude}, {selectedLocation.rawLongitude}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyCoordinates}
                          title="Copy exact coordinates"
                          className="p-1 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                        >
                          {copiedCoords ? (
                            <Check className="w-3.5 h-3.5 text-emerald-700" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </dd>
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <dt className="text-stone-500">Location Granularity</dt>
                      <dd className="font-mono-tabular text-stone-800">
                        {selectedLocation.granularity}
                      </dd>
                    </div>

                    <div className="py-2.5 flex items-center justify-between gap-4">
                      <dt className="text-stone-500 shrink-0">Place Identifier</dt>
                      <dd className="font-mono-tabular text-stone-700 truncate max-w-[210px]">
                        {selectedLocation.placeId}
                      </dd>
                    </div>

                    {selectedLocation.plusCode && (
                      <div className="py-2.5 flex items-center justify-between gap-4">
                        <dt className="text-stone-500">Plus Code</dt>
                        <dd className="font-mono-tabular text-stone-800">
                          {selectedLocation.plusCode}
                        </dd>
                      </div>
                    )}

                    {selectedLocation.viewport && (
                      <div className="py-2.5 space-y-1">
                        <dt className="text-stone-500">Viewport Bounding Box</dt>
                        <dd className="font-mono-tabular text-[11px] text-stone-700 flex items-center justify-between">
                          <span>
                            SW: {selectedLocation.viewport.south.toFixed(4)},{' '}
                            {selectedLocation.viewport.west.toFixed(4)}
                          </span>
                          <span>
                            NE: {selectedLocation.viewport.north.toFixed(4)},{' '}
                            {selectedLocation.viewport.east.toFixed(4)}
                          </span>
                        </dd>
                      </div>
                    )}
                  </dl>

                  {/* Structured Address Components */}
                  {selectedLocation.addressComponents.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs text-stone-500">
                        Structured Address Hierarchy
                      </div>
                      <div className="border-t border-stone-200 divide-y divide-stone-200">
                        {selectedLocation.addressComponents.slice(0, 6).map((comp, i) => (
                          <div
                            key={`${comp.longText}-${i}`}
                            className="py-1.5 flex items-center justify-between text-xs gap-3"
                          >
                            <span className="text-stone-800 font-medium truncate">
                              {comp.longText}
                              {comp.shortText && comp.shortText !== comp.longText
                                ? ` (${comp.shortText})`
                                : ''}
                            </span>
                            <span className="text-stone-500 font-mono-tabular text-[11px] shrink-0">
                              {comp.types[0]?.replace(/_/g, ' ') || 'component'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-6 text-xs text-stone-500 leading-relaxed">
                  {isLoading
                    ? 'Querying https://geocode.googleapis.com/v4/geocode/address/ ...'
                    : 'Submit a location above or select one of the five presets (Buenos Aires, Shibuya, Copacabana, Cologne, Lima) to inspect its geocoded dossier.'}
                </div>
              )}
            </section>

            {/* Recent Exploration Log */}
            {history.length > 1 && (
              <section
                aria-label="Recent Geocoded Queries"
                className="border-t border-stone-300 pt-5 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-xs uppercase tracking-widest text-stone-600 font-sans font-medium">
                    04. Session Gazetteer Log
                  </h2>
                  <span className="text-xs text-stone-500">
                    {history.length} entries
                  </span>
                </div>
                <div className="divide-y divide-stone-200 border-t border-stone-200">
                  {history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectHistoryItem(item)}
                      className="w-full py-2 text-left flex items-center justify-between gap-3 hover:bg-stone-200/40 px-1.5 transition-colors cursor-pointer"
                    >
                      <span className="text-xs font-medium text-stone-800 truncate">
                        {item.formattedAddress}
                      </span>
                      <span className="text-[11px] font-mono-tabular text-stone-500 shrink-0">
                        {item.rawLatitude.toFixed(3)}, {item.rawLongitude.toFixed(3)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Saved Locations Section (Persisted in localStorage) */}
            <section
              aria-label="Saved Locations"
              className="border-t border-stone-300 pt-5 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs uppercase tracking-widest text-stone-600 font-sans font-medium">
                  05. Saved Locations
                </h2>
                <span className="text-xs font-mono-tabular text-stone-500">
                  {savedLocations.length} saved
                </span>
              </div>

              {savedLocations.length > 0 ? (
                <ul className="divide-y divide-stone-200 border-t border-stone-200">
                  {savedLocations.map((saved) => (
                    <li
                      key={`${saved.id}-${saved.formattedAddress}`}
                      className="py-2 flex items-center justify-between gap-2 hover:bg-stone-200/40 px-1.5 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectHistoryItem(saved)}
                        className="flex-1 min-w-0 text-left flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-stone-900 truncate">
                            {saved.formattedAddress}
                          </div>
                          <div className="text-[11px] text-stone-500 truncate">
                            {saved.cityAndState}
                          </div>
                        </div>
                        <span className="text-[11px] font-mono-tabular text-stone-500 shrink-0">
                          {saved.rawLatitude.toFixed(3)}, {saved.rawLongitude.toFixed(3)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveBookmark(saved.id, saved.formattedAddress)
                        }
                        aria-label={`Remove ${saved.formattedAddress} from saved locations`}
                        title="Remove bookmark"
                        className="p-1 text-stone-400 hover:text-red-800 transition-colors shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-stone-500 py-2 leading-relaxed">
                  No bookmarked locations yet. Click the Bookmark button next to a geocoded location above to save it here.
                </p>
              )}
            </section>
          </div>

          {/* Editorial Footer */}
          <footer className="px-6 sm:px-8 lg:px-9 py-4 border-t border-stone-300 bg-[#F7F4EE] text-[11px] text-stone-500 flex flex-wrap items-center justify-between gap-2">
            <span>Block Explorer · Google Maps Platform</span>
            <div className="flex items-center gap-3">
              <a
                href="https://developers.google.com/maps/documentation/geocoding/geocoding?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-stone-900 underline"
              >
                Geocoding V4 Docs
              </a>
              <span>·</span>
              <a
                href="https://cloud.google.com/maps-platform/terms?utm_campaign=gmp_mcp_codeassist_v1_aistudio"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-stone-900 underline"
              >
                Terms of Service
              </a>
            </div>
          </footer>
        </aside>

        {/* Right-Side 2/3-Width Full-Height Interactive Map */}
        <main className="w-full lg:w-2/3 h-[58vh] lg:h-screen relative">
          <InteractiveMapCanvas
            selectedLocation={selectedLocation}
            panTrigger={panTrigger}
            isGeocoding={isLoading}
            hasApiKey={Boolean(API_KEY)}
            onMapSdkError={handleMapSdkError}
            onZoomChange={setCurrentZoom}
            insightsCityAndState={
              insightsCityAndState || selectedLocation?.cityAndState || ''
            }
            insightsHtml={insightsHtml}
            isLoadingInsights={isLoadingInsights}
            insightsError={insightsError}
            onRetryInsights={() =>
              loadLocalInsights(
                insightsCityAndState ||
                  selectedLocation?.cityAndState ||
                  activePreset ||
                  'Buenos Aires'
              )
            }
            onDismissInsightsError={() => setInsightsError(null)}
          />
        </main>
      </div>
    </APIProvider>
  );
}
