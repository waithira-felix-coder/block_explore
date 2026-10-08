/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APILoadingStatus,
  InfoWindow,
  Map,
  MapCameraChangedEvent,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  HelpCircle,
  Layers,
  Loader2,
  Minus,
  Navigation,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import {
  fetchLocalQuiz,
  QUIZ_CATEGORIES,
  QuizCategory,
  QuizQuestion,
} from '../services/localInsights';
import { ExploredLocation } from '../types/geocoding';

interface InteractiveMapCanvasProps {
  selectedLocation: ExploredLocation | null;
  panTrigger: number;
  isGeocoding: boolean;
  hasApiKey: boolean;
  onMapSdkError?: (message: string) => void;
  onZoomChange?: (zoom: number) => void;
  insightsCityAndState: string;
  insightsHtml: string | null;
  isLoadingInsights: boolean;
  insightsError: string | null;
  onRetryInsights: () => void;
  onDismissInsightsError: () => void;
}

type MapSurfaceType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

function MapCameraPanController({
  selectedLocation,
  panTrigger,
  requestedZoom,
  onZoomSynced,
}: {
  selectedLocation: ExploredLocation | null;
  panTrigger: number;
  requestedZoom: number | null;
  onZoomSynced: (zoom: number) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !selectedLocation) return;

    const { lat, lng } = selectedLocation.coordinates;
    map.panTo({ lat, lng });

    if (selectedLocation.viewport) {
      const { south, west, north, east } = selectedLocation.viewport;
      const latSpan = Math.abs(north - south);
      const lngSpan = Math.abs(east - west);
      if (latSpan > 0.0005 && lngSpan > 0.0005) {
        map.fitBounds(
          { south, west, north, east },
          { top: 72, right: 72, bottom: 180, left: 72 }
        );
        const currentZ = map.getZoom();
        if (typeof currentZ === 'number') {
          onZoomSynced(currentZ);
        }
        return;
      }
    }

    map.setZoom(14);
    onZoomSynced(14);
  }, [map, selectedLocation, panTrigger, onZoomSynced]);

  useEffect(() => {
    if (!map || requestedZoom === null) return;
    map.setZoom(requestedZoom);
    onZoomSynced(requestedZoom);
  }, [map, requestedZoom, onZoomSynced]);

  return null;
}

function CustomLocationMarker({
  location,
}: {
  location: ExploredLocation;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [infoWindowOpen, setInfoWindowOpen] = useState(true);

  useEffect(() => {
    setInfoWindowOpen(true);
  }, [location.id]);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={location.coordinates}
        title={location.formattedAddress}
        onClick={() => setInfoWindowOpen((prev) => !prev)}
      >
        <div className="relative flex flex-col items-center group cursor-pointer select-none">
          {/* Editorial Floating Coordinate Plate */}
          <div className="mb-1.5 px-2.5 py-1 bg-[#1C1917] text-[#FBF9F5] border border-stone-700 shadow-md flex items-center gap-2 transition-transform duration-150 group-hover:-translate-y-0.5">
            <span className="w-2 h-2 rounded-full bg-[#C2410C] animate-pulse shrink-0" />
            <span className="text-xs font-medium tracking-tight whitespace-nowrap max-w-[200px] truncate">
              {location.cityAndState || location.query}
            </span>
            <span className="text-[11px] font-mono-tabular text-stone-400 whitespace-nowrap">
              {location.rawLatitude.toFixed(4)}, {location.rawLongitude.toFixed(4)}
            </span>
          </div>

          {/* Custom Architectural Pin */}
          <div className="relative flex items-center justify-center w-9 h-9">
            <span className="absolute inset-0 rounded-full bg-[#C2410C]/25 animate-ping" />
            <span className="relative flex items-center justify-center w-7 h-7 rounded-full bg-[#9A3412] border-2 border-[#FBF9F5] shadow-lg text-[#FBF9F5]">
              <Crosshair className="w-3.5 h-3.5" />
            </span>
          </div>
          {/* Pin Stem */}
          <div className="w-0.5 h-3 bg-[#1C1917] -mt-1 shadow-sm" />
          <div className="w-2 h-1 rounded-full bg-[#1C1917]/40" />
        </div>
      </AdvancedMarker>

      {infoWindowOpen && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={300}
          onCloseClick={() => setInfoWindowOpen(false)}
        >
          <div className="p-1 text-stone-900 font-sans">
            <div className="text-[11px] uppercase tracking-widest text-stone-500 mb-1">
              Geocoded Block · {location.granularity}
            </div>
            <div className="text-sm font-semibold text-stone-900 leading-snug mb-1.5">
              {location.formattedAddress}
            </div>
            <div className="text-xs font-mono-tabular text-stone-700 border-t border-stone-200 pt-1.5 flex items-center justify-between gap-3">
              <span>
                {location.rawLatitude}, {location.rawLongitude}
              </span>
            </div>
            <div className="text-[11px] text-stone-500 mt-1">
              Google Maps
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

export default function InteractiveMapCanvas({
  selectedLocation,
  panTrigger,
  isGeocoding,
  hasApiKey,
  onMapSdkError,
  onZoomChange,
  insightsCityAndState,
  insightsHtml,
  isLoadingInsights,
  insightsError,
  onRetryInsights,
  onDismissInsightsError,
}: InteractiveMapCanvasProps) {
  const apiStatus = useApiLoadingStatus();
  const [mapType, setMapType] = useState<MapSurfaceType>('roadmap');
  const [cameraReadout, setCameraReadout] = useState<{
    lat: number;
    lng: number;
    zoom: number;
  }>({
    lat: 20.0,
    lng: 0.0,
    zoom: 3,
  });
  const [requestedZoom, setRequestedZoom] = useState<number | null>(null);
  const [localRecenterCount, setLocalRecenterCount] = useState(0);
  const [sdkErrorBanner, setSdkErrorBanner] = useState<string | null>(null);
  const [isInsightsCollapsed, setIsInsightsCollapsed] = useState(false);

  // Local Knowledge Quiz State
  const [showQuizCategories, setShowQuizCategories] = useState(false);
  const [selectedQuizCategory, setSelectedQuizCategory] =
    useState<QuizCategory | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>(
    {}
  );
  const [isQuizSubmitted, setIsQuizSubmitted] = useState(false);
  const quizAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handleSdkErrorEvent = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      const rawDetail = customEvent.detail || 'Google Maps SDK configuration error.';
      const cleanMessage = rawDetail.includes('ApiProjectMapError')
        ? 'ApiProjectMapError: Check that a valid VITE_GOOGLE_MAPS_API_KEY is configured and the Maps JavaScript API is enabled for your Cloud project.'
        : rawDetail;
      setSdkErrorBanner(cleanMessage);
      onMapSdkError?.(cleanMessage);
    };

    window.addEventListener('gmp-sdk-error', handleSdkErrorEvent);
    return () => window.removeEventListener('gmp-sdk-error', handleSdkErrorEvent);
  }, [onMapSdkError]);

  useEffect(() => {
    if (
      apiStatus === APILoadingStatus.AUTH_FAILURE ||
      apiStatus === APILoadingStatus.FAILED
    ) {
      const msg =
        apiStatus === APILoadingStatus.AUTH_FAILURE
          ? 'Maps JavaScript API authentication failed. Please verify your VITE_GOOGLE_MAPS_API_KEY and ensure Maps JavaScript API is enabled.'
          : 'Maps JavaScript API failed to load. Please check your network connection and API key configuration.';
      setSdkErrorBanner(msg);
      onMapSdkError?.(msg);
    }
  }, [apiStatus, onMapSdkError]);

  useEffect(() => {
    if (isLoadingInsights || insightsHtml || insightsError) {
      setIsInsightsCollapsed(false);
    }
  }, [insightsCityAndState, isLoadingInsights, insightsHtml, insightsError]);

  // Reset quiz state whenever the active place changes or new insights are loading
  useEffect(() => {
    quizAbortControllerRef.current?.abort();
    setShowQuizCategories(false);
    setSelectedQuizCategory(null);
    setQuizQuestions([]);
    setIsLoadingQuiz(false);
    setQuizError(null);
    setSelectedAnswers({});
    setIsQuizSubmitted(false);
  }, [insightsCityAndState, isLoadingInsights]);

  useEffect(() => {
    return () => {
      quizAbortControllerRef.current?.abort();
    };
  }, []);

  const handleSelectQuizCategory = useCallback(
    async (category: QuizCategory) => {
      const place =
        insightsCityAndState ||
        selectedLocation?.cityAndState ||
        selectedLocation?.formattedAddress ||
        '';
      if (!place) return;

      quizAbortControllerRef.current?.abort();
      const controller = new AbortController();
      quizAbortControllerRef.current = controller;

      setSelectedQuizCategory(category);
      setIsLoadingQuiz(true);
      setQuizError(null);
      setQuizQuestions([]);
      setSelectedAnswers({});
      setIsQuizSubmitted(false);

      try {
        const plainInsightsContext = insightsHtml
          ? insightsHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          : '';
        const response = await fetchLocalQuiz(
          place,
          category,
          plainInsightsContext,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setQuizQuestions(response.questions);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (!controller.signal.aborted) {
          setQuizError(
            err instanceof Error
              ? err.message
              : `Unable to generate the ${category} quiz for ${place}.`
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingQuiz(false);
        }
      }
    },
    [insightsCityAndState, insightsHtml, selectedLocation]
  );

  const handleSelectAnswer = (questionId: string, option: string) => {
    if (isQuizSubmitted) return;
    setSelectedAnswers((prev) => ({
      ...prev,
      [questionId]: option,
    }));
  };

  const handleQuizSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (quizQuestions.length === 0) return;
    setIsQuizSubmitted(true);
  };

  const handleRetakeQuiz = () => {
    setSelectedAnswers({});
    setIsQuizSubmitted(false);
  };

  const quizScore = quizQuestions.reduce((acc, q) => {
    const picked = (selectedAnswers[q.id] || '').trim().toLowerCase();
    const expected = (q.correctAnswer || '').trim().toLowerCase();
    return picked && picked === expected ? acc + 1 : acc;
  }, 0);

  const handleZoomSynced = useCallback(
    (newZoom: number) => {
      setCameraReadout((prev) => ({ ...prev, zoom: newZoom }));
      onZoomChange?.(newZoom);
    },
    [onZoomChange]
  );

  const handleCameraChange = useCallback(
    (ev: MapCameraChangedEvent) => {
      const { center, zoom } = ev.detail;
      setCameraReadout({
        lat: center.lat,
        lng: center.lng,
        zoom,
      });
      onZoomChange?.(zoom);
    },
    [onZoomChange]
  );

  const handleStepZoom = (delta: number) => {
    const nextZoom = Math.min(21, Math.max(1, Math.round(cameraReadout.zoom + delta)));
    setRequestedZoom(nextZoom);
    handleZoomSynced(nextZoom);
  };

  const mapSurfaceOptions: { id: MapSurfaceType; label: string }[] = [
    { id: 'roadmap', label: 'Atlas' },
    { id: 'satellite', label: 'Satellite' },
    { id: 'hybrid', label: 'Hybrid' },
    { id: 'terrain', label: 'Terrain' },
  ];

  const showLocalInsightsBanner = Boolean(
    isLoadingInsights || insightsHtml || insightsError || insightsCityAndState
  );

  return (
    <div className="relative w-full h-full bg-[#EBE6DF] overflow-hidden select-none">
      {/* Interactive Google Map Container */}
      <Map
        mapId="DEMO_MAP_ID"
        defaultCenter={{ lat: 20.0, lng: 0.0 }}
        defaultZoom={3}
        mapTypeId={mapType}
        gestureHandling="greedy"
        disableDefaultUI={false}
        mapTypeControl={false}
        streetViewControl={true}
        fullscreenControl={false}
        onCameraChanged={handleCameraChange}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
      >
        <MapCameraPanController
          selectedLocation={selectedLocation}
          panTrigger={panTrigger + localRecenterCount}
          requestedZoom={requestedZoom}
          onZoomSynced={handleZoomSynced}
        />

        {selectedLocation && (
          <CustomLocationMarker location={selectedLocation} />
        )}
      </Map>

      {/* Top-Left Map Control Panel: Layer Switcher & Current Zoom Level Indicator */}
      <div
        role="region"
        aria-label="Map Control Panel"
        className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2"
      >
        {/* Layer Switcher */}
        <div className="flex items-center gap-1 p-1 bg-[#FBF9F5]/95 backdrop-blur-sm border border-stone-300 shadow-sm">
          <span className="px-2 py-1 text-xs text-stone-500 flex items-center gap-1.5 border-r border-stone-200">
            <Layers className="w-3.5 h-3.5 text-stone-600" />
            <span className="hidden sm:inline">Layer</span>
          </span>
          {mapSurfaceOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMapType(option.id)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mapType === option.id
                  ? 'bg-[#1C1917] text-[#FBF9F5]'
                  : 'text-stone-700 hover:bg-stone-200/70'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Dedicated Current Zoom Level Indicator in Control Panel */}
        <div
          aria-label="Current Zoom Level Indicator"
          className="flex items-center gap-1.5 px-2.5 py-1 bg-[#FBF9F5]/95 backdrop-blur-sm border border-stone-300 shadow-sm text-xs text-stone-800"
        >
          <ZoomIn className="w-3.5 h-3.5 text-[#9A3412] shrink-0" />
          <span className="text-stone-500 whitespace-nowrap">Zoom Level:</span>
          <span
            data-testid="map-zoom-indicator"
            className="font-mono-tabular font-semibold text-stone-900 min-w-[2.25rem] text-center"
          >
            {cameraReadout.zoom.toFixed(1)}
          </span>
          <div className="flex items-center border-l border-stone-200 pl-1.5 gap-0.5">
            <button
              type="button"
              onClick={() => handleStepZoom(-1)}
              aria-label="Zoom out"
              title="Zoom out"
              className="p-1 text-stone-600 hover:text-stone-900 hover:bg-stone-200/70 transition-colors cursor-pointer"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => handleStepZoom(1)}
              aria-label="Zoom in"
              title="Zoom in"
              className="p-1 text-stone-600 hover:text-stone-900 hover:bg-stone-200/70 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Top-Right Recenter & Loading Indicator */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {isGeocoding && (
          <div className="px-3 py-1.5 bg-[#1C1917] text-[#FBF9F5] text-xs font-medium flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-[#C2410C] animate-ping" />
            <span className="whitespace-nowrap">Geocoding via V4 API...</span>
          </div>
        )}

        {selectedLocation && (
          <button
            type="button"
            onClick={() => setLocalRecenterCount((c) => c + 1)}
            title="Pan map back to active geocoded marker"
            className="px-3 py-1.5 bg-[#FBF9F5]/95 backdrop-blur-sm border border-stone-300 text-stone-900 hover:bg-stone-100 text-xs font-medium flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5 text-[#9A3412]" />
            <span>Recenter Pin</span>
          </button>
        )}
      </div>

      {/* Map SDK Auth / Load Failure Diagnostic Overlay Banner */}
      {(!hasApiKey ||
        Boolean(sdkErrorBanner) ||
        apiStatus === APILoadingStatus.AUTH_FAILURE ||
        apiStatus === APILoadingStatus.FAILED) && (
        <div className="absolute top-16 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-20 bg-[#FBF9F5] border border-amber-700/40 p-3.5 shadow-md">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
            <div className="text-xs text-stone-800 leading-relaxed">
              <p className="font-semibold text-stone-900">
                {!hasApiKey
                  ? 'Google Maps API Key Required for Live Tiles'
                  : 'Maps JavaScript SDK Diagnostic Notice'}
              </p>
              <p className="text-stone-600 mt-0.5">
                {sdkErrorBanner
                  ? sdkErrorBanner
                  : !hasApiKey
                    ? 'Configure VITE_GOOGLE_MAPS_API_KEY in the AI Studio Secrets panel to authenticate interactive map tiles and Geocoding V4 requests.'
                    : 'The Maps JavaScript API reported an authentication or loading issue. Check the troubleshooting panel on the left for full details.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Portion of Map Screen: Local Insights Banner, Local Knowledge Quiz & Viewport Readout */}
      <div className="absolute bottom-4 left-4 right-14 z-20 flex flex-col gap-2 pointer-events-none">
        {/* Live Viewport Telemetry Strip */}
        <div className="self-start pointer-events-auto px-3 py-1.5 bg-[#FBF9F5]/95 backdrop-blur-sm border border-stone-300 shadow-sm flex items-center gap-3 text-xs text-stone-700">
          <span className="flex items-center gap-1.5 text-stone-500">
            <Compass className="w-3.5 h-3.5 text-[#9A3412]" />
            <span className="hidden sm:inline">Viewport</span>
          </span>
          <span className="font-mono-tabular text-stone-900">
            {cameraReadout.lat.toFixed(4)}°, {cameraReadout.lng.toFixed(4)}°
          </span>
          <span aria-hidden="true" className="text-stone-300">
            ·
          </span>
          <span className="font-mono-tabular text-stone-700">
            Zoom {cameraReadout.zoom.toFixed(1)}
          </span>
        </div>

        {/* Local Insights & Local Knowledge Quiz AI Banner */}
        {showLocalInsightsBanner && (
          <section
            aria-label="Local Insights"
            className="pointer-events-auto w-full max-w-4xl bg-[#FBF9F5]/95 backdrop-blur-md border border-stone-300 shadow-lg transition-opacity duration-200 select-text"
          >
            {/* Banner Header */}
            <div className="px-4 py-2.5 border-b border-stone-200 bg-[#F7F4EE]/90 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <BookOpen className="w-4 h-4 text-[#9A3412] shrink-0" />
                <h2 className="text-sm font-editorial font-semibold tracking-wide text-stone-900 whitespace-nowrap">
                  Local Insights
                </h2>
                {insightsCityAndState && (
                  <>
                    <span aria-hidden="true" className="text-stone-400">
                      ·
                    </span>
                    <span className="text-xs font-medium text-stone-700 truncate">
                      {insightsCityAndState}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isLoadingInsights && (
                  <span className="text-[11px] text-stone-500 flex items-center gap-1.5 whitespace-nowrap">
                    <Loader2 className="w-3.5 h-3.5 text-[#9A3412] animate-spin" />
                    <span className="hidden sm:inline">Curating tour guide facts...</span>
                  </span>
                )}
                {!isLoadingInsights && insightsCityAndState && (
                  <button
                    type="button"
                    onClick={onRetryInsights}
                    title="Refresh Local Insights"
                    className="p-1 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsInsightsCollapsed((prev) => !prev)}
                  aria-label={
                    isInsightsCollapsed ? 'Expand Local Insights' : 'Collapse Local Insights'
                  }
                  className="p-1 text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                >
                  {isInsightsCollapsed ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Banner Content Body */}
            {!isInsightsCollapsed && (
              <div className="p-4 max-h-[68vh] overflow-y-auto space-y-4">
                {isLoadingInsights ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="py-3 flex items-center gap-3 text-xs text-stone-600"
                  >
                    <Loader2 className="w-4 h-4 text-[#9A3412] animate-spin shrink-0" />
                    <span>
                      Consulting local tour guide intelligence for{' '}
                      <strong className="font-semibold text-stone-900">
                        {insightsCityAndState || 'this destination'}
                      </strong>
                      ...
                    </span>
                  </div>
                ) : insightsError ? (
                  <div
                    role="alert"
                    className="bg-red-50/80 border border-red-800/30 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-red-800 shrink-0 mt-0.5" />
                      <div className="text-xs text-red-900 leading-relaxed">
                        <span className="font-semibold text-red-950">
                          Local Insights Unavailable:{' '}
                        </span>
                        {insightsError}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={onRetryInsights}
                        className="px-2.5 py-1 bg-red-900 hover:bg-red-950 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                      <button
                        type="button"
                        onClick={onDismissInsightsError}
                        aria-label="Dismiss Local Insights error"
                        className="p-1 text-red-800 hover:text-red-950 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : insightsHtml ? (
                  <div className="space-y-3.5">
                    <div
                      data-testid="local-insights-content"
                      className="text-xs sm:text-[13px] text-stone-800 leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_li]:marker:text-[#9A3412]"
                      dangerouslySetInnerHTML={{ __html: insightsHtml }}
                    />

                    {/* Local Knowledge Game Trigger & Interactive Quiz Section */}
                    <div className="pt-3 border-t border-stone-200/90 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        {!showQuizCategories ? (
                          <button
                            type="button"
                            onClick={() => setShowQuizCategories(true)}
                            className="px-3.5 py-2 bg-[#1C1917] hover:bg-[#292524] text-[#FBF9F5] text-xs font-semibold tracking-wide uppercase flex items-center gap-2 transition-colors cursor-pointer"
                          >
                            <HelpCircle
                              className="w-3.5 h-3.5 text-[#C2410C]"
                              aria-hidden="true"
                            />
                            <span>Test their local knowledge</span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <HelpCircle
                              className="w-4 h-4 text-[#9A3412]"
                              aria-hidden="true"
                            />
                            <span className="text-xs font-semibold uppercase tracking-wider text-stone-900">
                              Local Knowledge Quiz · {insightsCityAndState}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-3 text-[11px] text-stone-500 ml-auto">
                          <span>Google Maps</span>
                          <span>·</span>
                          <span className="font-mono-tabular">gemini-3.8-flash</span>
                        </div>
                      </div>

                      {/* 3 Category Options once "Test their local knowledge" is clicked */}
                      {showQuizCategories && (
                        <div className="bg-[#F7F4EE] border border-stone-300 p-3.5 space-y-3.5">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-stone-700">
                                Select a category to generate a 3-question quiz about{' '}
                                <strong className="font-semibold text-stone-900">
                                  {insightsCityAndState}
                                </strong>
                                :
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  quizAbortControllerRef.current?.abort();
                                  setShowQuizCategories(false);
                                  setSelectedQuizCategory(null);
                                  setQuizQuestions([]);
                                  setQuizError(null);
                                  setSelectedAnswers({});
                                  setIsQuizSubmitted(false);
                                }}
                                aria-label="Close quiz"
                                className="text-stone-400 hover:text-stone-800 p-0.5 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div
                              role="group"
                              aria-label="Quiz Category Options"
                              className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                            >
                              {QUIZ_CATEGORIES.map((category) => {
                                const isActiveCategory =
                                  selectedQuizCategory === category;
                                return (
                                  <button
                                    key={category}
                                    type="button"
                                    disabled={isLoadingQuiz}
                                    onClick={() => handleSelectQuizCategory(category)}
                                    className={`px-3 py-2 border text-xs font-semibold tracking-tight text-left flex items-center justify-between transition-colors cursor-pointer ${
                                      isActiveCategory
                                        ? 'bg-[#1C1917] text-[#FBF9F5] border-[#1C1917]'
                                        : 'bg-white hover:bg-[#EBE6DF] text-stone-900 border-stone-300'
                                    }`}
                                  >
                                    <span>{category}</span>
                                    <span
                                      aria-hidden="true"
                                      className={`w-2 h-2 rounded-full ${
                                        isActiveCategory
                                          ? 'bg-[#C2410C]'
                                          : 'bg-stone-300'
                                      }`}
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Loading State while generating the 3-question quiz */}
                          {isLoadingQuiz && (
                            <div
                              role="status"
                              aria-live="polite"
                              className="py-3 border-t border-stone-200 flex items-center gap-2.5 text-xs text-stone-600"
                            >
                              <Loader2 className="w-4 h-4 text-[#9A3412] animate-spin shrink-0" />
                              <span>
                                Generating 3-question{' '}
                                <strong className="font-semibold text-stone-900">
                                  {selectedQuizCategory}
                                </strong>{' '}
                                quiz for {insightsCityAndState}...
                              </span>
                            </div>
                          )}

                          {/* Error State if quiz generation fails */}
                          {quizError && !isLoadingQuiz && (
                            <div
                              role="alert"
                              className="border border-red-800/30 bg-red-50/90 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                            >
                              <div className="flex items-start gap-2 text-xs text-red-900">
                                <AlertCircle className="w-4 h-4 text-red-800 shrink-0 mt-0.5" />
                                <span>{quizError}</span>
                              </div>
                              {selectedQuizCategory && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectQuizCategory(selectedQuizCategory)
                                  }
                                  className="px-2.5 py-1 bg-red-900 hover:bg-red-950 text-white text-xs font-medium flex items-center gap-1.5 self-end sm:self-center shrink-0 cursor-pointer"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  <span>Retry Quiz</span>
                                </button>
                              )}
                            </div>
                          )}

                          {/* 3-Question Multiple-Choice Quiz Form */}
                          {!isLoadingQuiz && quizQuestions.length > 0 && (
                            <form
                              onSubmit={handleQuizSubmit}
                              className="border-t border-stone-300 pt-3.5 space-y-4"
                            >
                              {/* Score Result Banner once submitted */}
                              {isQuizSubmitted && (
                                <div
                                  role="status"
                                  aria-live="polite"
                                  data-testid="quiz-score-banner"
                                  className="p-3 bg-[#1C1917] text-[#FBF9F5] border border-stone-800 flex flex-wrap items-center justify-between gap-3"
                                >
                                  <div className="flex items-center gap-2.5">
                                    <Award className="w-4 h-4 text-[#C2410C] shrink-0" />
                                    <div className="text-xs">
                                      <span className="font-semibold uppercase tracking-wider">
                                        Quiz Score:{' '}
                                      </span>
                                      <span className="font-mono-tabular font-bold text-sm text-[#FBF9F5]">
                                        {quizScore} / {quizQuestions.length}
                                      </span>
                                      <span className="text-stone-300 ml-2">
                                        ({quizScore} out of {quizQuestions.length} correct ·{' '}
                                        {Math.round(
                                          (quizScore / quizQuestions.length) * 100
                                        )}
                                        %)
                                      </span>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={handleRetakeQuiz}
                                    className="px-2.5 py-1 bg-[#FBF9F5] hover:bg-stone-200 text-[#1C1917] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                    <span>Retake Quiz</span>
                                  </button>
                                </div>
                              )}

                              <div className="space-y-3.5">
                                {quizQuestions.map((q, index) => {
                                  const userAnswer = selectedAnswers[q.id];
                                  const isCorrect =
                                    Boolean(userAnswer) &&
                                    userAnswer.trim().toLowerCase() ===
                                      q.correctAnswer.trim().toLowerCase();

                                  return (
                                    <fieldset
                                      key={q.id}
                                      className="bg-white border border-stone-300 p-3 space-y-2.5"
                                    >
                                      <legend className="text-xs font-semibold text-stone-900 leading-snug px-1">
                                        {index + 1}. {q.question}
                                      </legend>

                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                        {q.options.map((option, optIdx) => {
                                          const isSelected = userAnswer === option;
                                          const isThisOptionCorrect =
                                            option.trim().toLowerCase() ===
                                            q.correctAnswer.trim().toLowerCase();

                                          let optionStyle =
                                            'bg-[#FBF9F5] hover:bg-[#EBE6DF]/70 border-stone-300 text-stone-800';
                                          if (isQuizSubmitted) {
                                            if (isThisOptionCorrect) {
                                              optionStyle =
                                                'bg-emerald-50 border-emerald-700 text-emerald-950 font-semibold';
                                            } else if (isSelected && !isThisOptionCorrect) {
                                              optionStyle =
                                                'bg-red-50 border-red-700 text-red-950 line-through';
                                            } else {
                                              optionStyle =
                                                'bg-stone-50 border-stone-200 text-stone-500';
                                            }
                                          } else if (isSelected) {
                                            optionStyle =
                                              'bg-[#1C1917] text-[#FBF9F5] border-[#1C1917] font-medium';
                                          }

                                          return (
                                            <label
                                              key={`${q.id}-opt-${optIdx}`}
                                              className={`px-2.5 py-2 border text-xs flex items-start gap-2 transition-colors ${
                                                isQuizSubmitted
                                                  ? 'cursor-default'
                                                  : 'cursor-pointer'
                                              } ${optionStyle}`}
                                            >
                                              <input
                                                type="radio"
                                                name={q.id}
                                                value={option}
                                                checked={isSelected}
                                                disabled={isQuizSubmitted}
                                                onChange={() =>
                                                  handleSelectAnswer(q.id, option)
                                                }
                                                className="mt-0.5 accent-[#9A3412] shrink-0 cursor-pointer"
                                              />
                                              <span className="leading-snug flex-1">
                                                {option}
                                              </span>
                                            </label>
                                          );
                                        })}
                                      </div>

                                      {/* Correct Answer & Explanation shown after quiz submission */}
                                      {isQuizSubmitted && (
                                        <div className="pt-2 border-t border-stone-200 text-xs space-y-1">
                                          <div className="flex items-center gap-1.5 font-medium">
                                            {isCorrect ? (
                                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                            ) : (
                                              <XCircle className="w-3.5 h-3.5 text-red-700 shrink-0" />
                                            )}
                                            <span
                                              className={
                                                isCorrect
                                                  ? 'text-emerald-800'
                                                  : 'text-red-800'
                                              }
                                            >
                                              {isCorrect ? 'Correct!' : 'Incorrect.'}
                                            </span>
                                            <span className="text-stone-800">
                                              Correct Answer:{' '}
                                              <strong className="font-semibold text-stone-950">
                                                {q.correctAnswer}
                                              </strong>
                                            </span>
                                          </div>
                                          {q.explanation && (
                                            <p className="text-stone-600 leading-relaxed pl-5">
                                              {q.explanation}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </fieldset>
                                  );
                                })}
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                                {!isQuizSubmitted ? (
                                  <>
                                    <span className="text-[11px] text-stone-500 font-mono-tabular">
                                      {Object.keys(selectedAnswers).length} of{' '}
                                      {quizQuestions.length} answered
                                    </span>
                                    <button
                                      type="submit"
                                      className="px-4 py-2 bg-[#9A3412] hover:bg-[#7C2D12] text-[#FBF9F5] text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                                    >
                                      Submit Quiz
                                    </button>
                                  </>
                                ) : (
                                  <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-stone-700">
                                    <span>
                                      Final Score:{' '}
                                      <strong className="font-mono-tabular text-stone-900">
                                        {quizScore} / {quizQuestions.length}
                                      </strong>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={handleRetakeQuiz}
                                      className="px-3 py-1.5 border border-stone-300 bg-white hover:bg-stone-100 text-stone-900 text-xs font-medium transition-colors cursor-pointer"
                                    >
                                      Try Again
                                    </button>
                                  </div>
                                )}
                              </div>
                            </form>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
