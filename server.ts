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

const PORT = 3000;

const TEXT_MODEL_CANDIDATES = [
  'gemini-3.8-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
] as const;

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
  // Strip optional markdown code fences if present
  const stripped = rawText
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Extract the <ul>...</ul> block if present
  const ulMatch = stripped.match(/<ul[\s\S]*<\/ul>/i);
  if (ulMatch) {
    return ulMatch[0];
  }

  // Fallback: wrap lines in a clean <ul> if the model returned plain bullet lines
  const lines = stripped
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
  }

  return '';
}

async function startServer() {
  const app = express();
  app.use(express.json());

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

    if (!cityAndState || !category) {
      res.status(400).json({
        error: 'Both City/State and quiz category are required to generate the quiz.',
      });
      return;
    }

    const prompt = `You are a knowledgeable local tour guide for ${cityAndState}.
Generate a 3-question multiple-choice quiz about ${cityAndState} focused specifically on the category: "${category}".
${insightsContext ? `You may also draw inspiration from these local insights about the place: ${insightsContext}` : ''}
Requirements:
- Provide exactly 3 engaging, accurate multiple-choice questions based on real places, traditions, or facts in ${cityAndState}.
- Each question must have exactly 4 distinct answer options.
- "correctAnswer" must match one of the 4 strings in "options" verbatim.
- Include a brief 1-sentence "explanation" giving context about the correct answer.`;

    try {
      const ai = getGeminiClient();
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
