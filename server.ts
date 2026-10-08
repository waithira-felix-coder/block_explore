/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const MAPS_GROUNDING_LITE_MCP_URL = 'https://mapstools.googleapis.com/mcp';

const TEXT_MODEL_CANDIDATES = [
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
] as const;

export interface GroundingSourceLink {
  title: string;
  uri: string;
}

function getMapsPlatformKeyInfo(): { apiKey: string; envVarName: string } {
  const gmpKey = (process.env.GOOGLE_MAPS_PLATFORM_KEY || '').trim();
  return { apiKey: gmpKey, envVarName: 'GOOGLE_MAPS_PLATFORM_KEY' };
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function generateContentResilient(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, 'model'>
): Promise<GenerateContentResponse> {
  let lastError: unknown;
  for (const modelName of TEXT_MODEL_CANDIDATES) {
    try {
      const config =
        modelName === 'gemini-3.8-flash'
          ? {
              ...params.config,
              thinkingConfig: {
                thinkingLevel: ThinkingLevel.LOW,
              },
            }
          : params.config;

      return await ai.models.generateContent({
        ...params,
        model: modelName,
        config,
      });
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('429') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('high demand') ||
        msg.includes('overloaded');
      if (!isTransient) {
        throw err;
      }
    }
  }
  throw lastError;
}

function cleanHtmlUnorderedList(rawText: string): string {
  const stripped = rawText
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const ulMatch = stripped.match(/<ul[\s\S]*<\/ul>/i);
  if (ulMatch) {
    return ulMatch[0];
  }

  const lines = stripped
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
  }

  return '';
}

/**
 * Calls the Google Maps Grounding Lite MCP server (https://mapstools.googleapis.com/mcp)
 * using the `search_places` tool, plus Gemini Maps Grounding (`tools: [{ googleMaps: {} }]`),
 * to gather verifiable hyperlocal place facts and Google Maps attribution links.
 */
async function fetchHyperlocalGroundedData(
  ai: GoogleGenAI,
  cityAndState: string,
  category: string,
  coordinates?: { lat: number; lng: number } | null
): Promise<{ groundedContext: string; sources: GroundingSourceLink[] }> {
  const sourcesMap = new Map<string, GroundingSourceLink>();
  const contextSnippets: string[] = [];

  const categorySearchFocus =
    category === 'Local cuisine'
      ? `historic cafes, iconic neighborhood restaurants, markets, and traditional food institutions in ${cityAndState}`
      : category === 'Art and culture'
        ? `cultural centers, theaters, architectural landmarks, galleries, and museums in ${cityAndState}`
        : `historic monuments, oldest streets, heritage plazas, and historical sites in ${cityAndState}`;

  // 1. Attempt direct call to Google Maps Grounding Lite MCP `search_places` tool
  const { apiKey: mapsApiKey } = getMapsPlatformKeyInfo();

  if (mapsApiKey) {
    try {
      const mcpController = new AbortController();
      const timeoutId = setTimeout(() => mcpController.abort(), 3500);

      const mcpArguments: Record<string, unknown> = {
        text_query: categorySearchFocus,
      };
      if (
        coordinates &&
        typeof coordinates.lat === 'number' &&
        typeof coordinates.lng === 'number'
      ) {
        mcpArguments.location_bias = {
          circle: {
            center: {
              latitude: coordinates.lat,
              longitude: coordinates.lng,
            },
            radius_meters: 8000,
          },
        };
      }

      const mcpRes = await fetch(MAPS_GROUNDING_LITE_MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-Goog-Api-Key': mapsApiKey,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'search_places',
            arguments: mcpArguments,
          },
        }),
        signal: mcpController.signal,
      });
      clearTimeout(timeoutId);

      if (mcpRes.ok) {
        const rawBody = await mcpRes.text();
        const jsonLine = rawBody
          .split('\n')
          .map((l) => l.replace(/^data:\s*/, '').trim())
          .find((l) => l.startsWith('{'));
        if (jsonLine) {
          const mcpJson = JSON.parse(jsonLine);
          const resultObj = mcpJson?.result;
          const structured = resultObj?.structuredContent || {};
          if (typeof structured.summary === 'string' && structured.summary.trim()) {
            contextSnippets.push(
              `Maps Grounding Lite (search_places) Summary:\n${structured.summary.trim()}`
            );
          }
          if (Array.isArray(structured.places)) {
            for (const p of structured.places.slice(0, 6)) {
              const title = p.displayName?.text || p.name || p.id || 'Google Maps Place';
              const uri =
                p.googleMapsUri ||
                (p.id ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : '');
              if (uri) {
                sourcesMap.set(uri, { title, uri });
              }
            }
          }
        }
      }
    } catch {
      // Proceed seamlessly to Gemini Maps Grounding tool
    }
  }

  // 2. Ground with Gemini API using Google Maps Grounding tool (`googleMaps: {}`)
  try {
    const groundedResponse = await generateContentResilient(ai, {
      contents: `Find 4 to 5 specific, real local places in ${cityAndState} related to "${category}" (${categorySearchFocus}). Include their exact neighborhood or street address, historical or cultural significance, architectural details, or signature specialties.`,
      config: {
        // Per @google/genai rules: DO NOT set responseMimeType or responseSchema with googleMaps
        tools: [{ googleMaps: {} }],
        ...(coordinates &&
        typeof coordinates.lat === 'number' &&
        typeof coordinates.lng === 'number'
          ? {
              toolConfig: {
                retrievalConfig: {
                  latLng: {
                    latitude: coordinates.lat,
                    longitude: coordinates.lng,
                  },
                },
              },
            }
          : {}),
      },
    });

    if (groundedResponse.text) {
      contextSnippets.push(groundedResponse.text.trim());
    }

    const groundingChunks =
      groundedResponse.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (Array.isArray(groundingChunks)) {
      for (const chunk of groundingChunks) {
        const mapsData = (chunk as {
          maps?: {
            uri?: string;
            title?: string;
            text?: string;
            placeAnswerSources?: {
              reviewSnippets?: Array<{ uri?: string; title?: string; text?: string }>;
            };
          };
        })?.maps;

        if (mapsData) {
          if (mapsData.uri) {
            sourcesMap.set(mapsData.uri, {
              title: mapsData.title || 'Google Maps Place',
              uri: mapsData.uri,
            });
          }
          if (mapsData.text) {
            contextSnippets.push(mapsData.text.slice(0, 600));
          }
          const snippets = mapsData.placeAnswerSources?.reviewSnippets;
          if (Array.isArray(snippets)) {
            for (const snippet of snippets) {
              if (snippet.uri) {
                sourcesMap.set(snippet.uri, {
                  title: snippet.title || mapsData.title || 'Google Maps Review',
                  uri: snippet.uri,
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // Fallback if grounding tool is unavailable
  }

  return {
    groundedContext: contextSnippets.join('\n\n'),
    sources: Array.from(sourcesMap.values()).slice(0, 6),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Allow cross-origin requests to /api/* when the static frontend is hosted on GitHub Pages
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/maps-config', (_req, res) => {
    const info = getMapsPlatformKeyInfo();
    res.json(info);
  });

  app.post('/api/local-insights', async (req, res) => {
    const cityAndState =
      typeof req.body?.cityAndState === 'string' ? req.body.cityAndState.trim() : '';

    if (!cityAndState) {
      res.status(400).json({
        error: 'A valid City and State (e.g., "Miami, Florida") is required to generate local insights.',
      });
      return;
    }

    const prompt = `You are a local tour guide for ${cityAndState}. Give me exactly 3 short, highly engaging, and unusual or surprising fun facts about this place. Keep each fact under 2 sentences. Format the response as a clean HTML unordered list (<ul>) so I can inject it directly.`;

    try {
      const ai = getGeminiClient();
      const response: GenerateContentResponse = await generateContentResilient(ai, {
        contents: prompt,
      });

      const rawText = response.text ?? '';
      const htmlList = cleanHtmlUnorderedList(rawText);

      if (!htmlList) {
        res.status(502).json({
          error: `Could not generate local insights for ${cityAndState}. Please try again.`,
        });
        return;
      }

      res.json({
        cityAndState,
        html: htmlList,
      });
    } catch (err) {
      const errMessage =
        err instanceof Error
          ? err.message
          : 'Failed to retrieve local insights from the Gemini API.';
      res.status(500).json({
        error: `Unable to load Local Insights for ${cityAndState}: ${errMessage}`,
      });
    }
  });

  app.post('/api/local-quiz', async (req, res) => {
    const cityAndState =
      typeof req.body?.cityAndState === 'string' ? req.body.cityAndState.trim() : '';
    const category =
      typeof req.body?.category === 'string' ? req.body.category.trim() : '';
    const insightsContext =
      typeof req.body?.insightsContext === 'string' ? req.body.insightsContext.trim() : '';
    const hyperlocalMode = Boolean(req.body?.hyperlocalMode);
    const coordinates =
      req.body?.coordinates &&
      typeof req.body.coordinates.lat === 'number' &&
      typeof req.body.coordinates.lng === 'number'
        ? { lat: req.body.coordinates.lat, lng: req.body.coordinates.lng }
        : null;

    if (!cityAndState || !category) {
      res.status(400).json({
        error: 'Both City/State and quiz category are required to generate the quiz.',
      });
      return;
    }

    try {
      const ai = getGeminiClient();
      let groundedContext = '';
      let groundingSources: GroundingSourceLink[] = [];

      if (hyperlocalMode) {
        const grounded = await fetchHyperlocalGroundedData(
          ai,
          cityAndState,
          category,
          coordinates
        );
        groundedContext = grounded.groundedContext;
        groundingSources = grounded.sources;
      }

      const difficultyInstructions = hyperlocalMode
        ? `HYPERLOCAL MODE ENABLED (HIGH DIFFICULTY):
- Use the grounded Google Maps place data below to craft 3 distinctly challenging, hyperlocal multiple-choice questions about ${cityAndState} in the category "${category}".
- Test granular local knowledge that only a seasoned local or attentive explorer would know: specific neighborhood names, exact street/avenue locations of real landmarks or institutions, founding eras, architectural features, or signature dishes/works at real venues.
- Make the 3 distractors plausible local alternatives (e.g., real neighboring districts, avenues, or local traditions) so the quiz is genuinely challenging.
${groundedContext ? `\nGrounded Google Maps Local Data:\n${groundedContext}\n` : ''}`
        : `STANDARD MODE:
- Provide 3 engaging, accessible multiple-choice questions based on real places, traditions, or facts in ${cityAndState} focused on "${category}".`;

      const prompt = `You are a knowledgeable local tour guide for ${cityAndState}.
Generate a 3-question multiple-choice quiz about ${cityAndState} focused specifically on the category: "${category}".
${insightsContext ? `You may also draw inspiration from these local insights about the place: ${insightsContext}` : ''}
${difficultyInstructions}
Requirements:
- Provide_exactly 3 multiple-choice questions.
- Each question must have exactly 4 distinct answer options.
- "correctAnswer" must match one of the 4 strings in "options" verbatim.
- Include a brief 1-sentence "explanation" giving specific local context about the correct answer.`;

      const response: GenerateContentResponse = await generateContentResilient(ai, {
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                description: 'Exactly 3 multiple-choice quiz questions.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: {
                      type: Type.STRING,
                      description: 'The quiz question text.',
                    },
                    options: {
                      type: Type.ARRAY,
                      description: 'Exactly 4 multiple-choice options.',
                      items: {
                        type: Type.STRING,
                      },
                    },
                    correctAnswer: {
                      type: Type.STRING,
                      description: 'The exact string from options that is correct.',
                    },
                    explanation: {
                      type: Type.STRING,
                      description: 'A 1-sentence explanation of the correct answer.',
                    },
                  },
                  required: ['question', 'options', 'correctAnswer', 'explanation'],
                },
              },
            },
            required: ['questions'],
          },
        },
      });

      const rawJson = (response.text ?? '').trim();
      const parsed = JSON.parse(rawJson) as {
        questions?: Array<{
          question: string;
          options: string[];
          correctAnswer: string;
          explanation?: string;
        }>;
      };

      const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 3) : [];
      if (rawQuestions.length === 0) {
        res.status(502).json({
          error: `Could not generate quiz questions for ${cityAndState}. Please try again.`,
        });
        return;
      }

      const normalizedQuestions = rawQuestions.map((q, idx) => {
        const opts = Array.isArray(q.options) && q.options.length > 0 ? q.options : [];
        const matchedOption =
          opts.find(
            (o) => o.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase()
          ) ??
          opts[0] ??
          q.correctAnswer;

        return {
          id: `q-${idx + 1}`,
          question: q.question,
          options: opts,
          correctAnswer: matchedOption,
          explanation: q.explanation || '',
        };
      });

      res.json({
        cityAndState,
        category,
        hyperlocalMode,
        groundingSources,
        questions: normalizedQuestions,
      });
    } catch (err) {
      const errMessage =
        err instanceof Error
          ? err.message
          : 'Failed to generate the local knowledge quiz from the Gemini API.';
      res.status(500).json({
        error: `Unable to generate quiz for ${cityAndState} (${category}): ${errMessage}`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Block Explorer server listening on http://localhost:${PORT}`);
  });
}

startServer();
