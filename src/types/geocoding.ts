/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GeocodeV4LatLng {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
}

export interface GeocodeV4Viewport {
  low?: GeocodeV4LatLng;
  high?: GeocodeV4LatLng;
  southwest?: GeocodeV4LatLng;
  northeast?: GeocodeV4LatLng;
}

export interface GeocodeV4AddressComponent {
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
  types?: string[];
  languageCode?: string;
}

export interface GeocodeV4PostalAddress {
  regionCode?: string;
  languageCode?: string;
  postalCode?: string;
  administrativeArea?: string;
  locality?: string;
  addressLines?: string[];
}

export interface GeocodeV4PlusCode {
  globalCode?: string;
  compoundCode?: string;
  global_code?: string;
  compound_code?: string;
}

export interface GeocodeV4Result {
  place?: string;
  placeId?: string;
  place_id?: string;
  formattedAddress?: string;
  formatted_address?: string;
  location?: GeocodeV4LatLng;
  geometry?: {
    location?: GeocodeV4LatLng;
    location_type?: string;
    viewport?: GeocodeV4Viewport;
  };
  granularity?: string;
  viewport?: GeocodeV4Viewport;
  bounds?: GeocodeV4Viewport;
  types?: string[];
  plusCode?: GeocodeV4PlusCode;
  plus_code?: GeocodeV4PlusCode;
  postalAddress?: GeocodeV4PostalAddress;
  addressComponents?: GeocodeV4AddressComponent[];
  address_components?: GeocodeV4AddressComponent[];
}

export interface GeocodeV4Response {
  results?: GeocodeV4Result[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
  status?: string;
  error_message?: string;
}

export interface NormalizedAddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

export interface ExploredLocation {
  id: string;
  query: string;
  cityAndState: string;
  formattedAddress: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  rawLatitude: number;
  rawLongitude: number;
  granularity: string;
  placeId: string;
  types: string[];
  plusCode?: string;
  regionCode?: string;
  viewport?: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  addressComponents: NormalizedAddressComponent[];
  timestamp: string;
  durationMs: number;
  endpointUrl: string;
}

export interface GeocodeErrorState {
  title: string;
  message: string;
  code?: number | string;
  status?: string;
  reason?: string;
  query: string;
  endpointUrl: string;
  timestamp: string;
  troubleshootingTips: string[];
}

export interface PresetDestination {
  index: string;
  name: string;
  regionLabel: string;
  editorialNote: string;
}

export const PRESET_DESTINATIONS: PresetDestination[] = [
  {
    index: '01',
    name: 'Buenos Aires',
    regionLabel: 'Argentina',
    editorialNote: ' Diagonal avenues, neoclassical blocks, and riverfront grid geometry',
  },
  {
    index: '02',
    name: 'Shibuya',
    regionLabel: 'Tokyo, Japan',
    editorialNote: 'High-density pedestrian scrambles, rail corridors, and vertical districts',
  },
  {
    index: '03',
    name: 'Copacabana',
    regionLabel: 'Rio de Janeiro, Brazil',
    editorialNote: 'Oceanfront crescent promenade framed by Atlantic granite peaks',
  },
  {
    index: '04',
    name: 'Cologne',
    regionLabel: 'North Rhine-Westphalia, Germany',
    editorialNote: 'Roman street foundations, Rhine crossings, and Gothic cathedral axis',
  },
  {
    index: '05',
    name: 'Lima',
    regionLabel: 'Peru',
    editorialNote: 'Pacific cliffside malecones, historic damero blocks, and coastal valleys',
  },
];
