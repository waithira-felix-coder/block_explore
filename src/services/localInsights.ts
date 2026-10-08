/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LocalInsightsResponse {
  cityAndState: string;
  html: string;
}

export type QuizCategory = 'Local cuisine' | 'Art and culture' | 'Local history';

export const QUIZ_CATEGORIES: QuizCategory[] = [
  'Local cuisine',
  'Art and culture',
  'Local history',
];

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface GroundingSourceLink {
  title: string;
  uri: string;
}

export interface LocalQuizResponse {
  cityAndState: string;
  category: QuizCategory;
  hyperlocalMode: boolean;
  groundingSources: GroundingSourceLink[];
  questions: QuizQuestion[];
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export async function fetchLocalInsights(
  cityAndState: string,
  signal?: AbortSignal
): Promise<LocalInsightsResponse> {
  const trimmed = cityAndState.trim();
  if (!trimmed) {
    throw new Error('City and State are required to request local insights.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/local-insights`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cityAndState: trimmed }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new Error(
      'Network error while contacting the Local Insights AI service. Please check your connection and try again.'
    );
  }

  let payload: { cityAndState?: string; html?: string; error?: string };
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Local Insights service returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok || payload.error || !payload.html) {
    throw new Error(
      payload.error ||
        `Unable to generate Local Insights for ${trimmed} (HTTP ${response.status}).`
    );
  }

  return {
    cityAndState: payload.cityAndState || trimmed,
    html: payload.html,
  };
}

export interface FetchLocalQuizOptions {
  cityAndState: string;
  category: QuizCategory;
  insightsContext?: string;
  hyperlocalMode?: boolean;
  coordinates?: { lat: number; lng: number } | null;
  signal?: AbortSignal;
}

export async function fetchLocalQuiz({
  cityAndState,
  category,
  insightsContext,
  hyperlocalMode = false,
  coordinates = null,
  signal,
}: FetchLocalQuizOptions): Promise<LocalQuizResponse> {
  const trimmedPlace = cityAndState.trim();
  if (!trimmedPlace) {
    throw new Error('City and State are required to generate a local quiz.');
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/local-quiz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cityAndState: trimmedPlace,
        category,
        insightsContext: insightsContext || '',
        hyperlocalMode,
        coordinates,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new Error(
      'Network error while contacting the Local Knowledge Quiz service. Please check your connection and try again.'
    );
  }

  let payload: {
    cityAndState?: string;
    category?: QuizCategory;
    hyperlocalMode?: boolean;
    groundingSources?: GroundingSourceLink[];
    questions?: QuizQuestion[];
    error?: string;
  };
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Local Quiz service returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok || payload.error || !Array.isArray(payload.questions) || payload.questions.length === 0) {
    throw new Error(
      payload.error ||
        `Unable to generate the ${category} quiz for ${trimmedPlace} (HTTP ${response.status}).`
    );
  }

  return {
    cityAndState: payload.cityAndState || trimmedPlace,
    category: payload.category || category,
    hyperlocalMode: Boolean(payload.hyperlocalMode ?? hyperlocalMode),
    groundingSources: Array.isArray(payload.groundingSources)
      ? payload.groundingSources
      : [],
    questions: payload.questions,
  };
}
