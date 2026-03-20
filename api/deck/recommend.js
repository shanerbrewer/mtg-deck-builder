/**
 * POST /api/deck/recommend
 *
 * Sends a Commander decklist to Claude via the Vercel AI SDK and returns
 * AI-powered card recommendations with theme analysis.
 *
 * Request body:  { "text": "...", "deckName": "optional" }
 * Response:
 *   {
 *     theme:           string,
 *     analysis:        string,
 *     recommendations: [{ name, reason, role, replaces? }],
 *   }
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BODY_BYTES = 64_000;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return error(405, 'Method not allowed. Use POST.');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return error(503, 'AI recommendations unavailable. Add ANTHROPIC_API_KEY to your Vercel environment variables.');
  }

  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return error(413, 'Request body too large. Max 64 KB.');
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return error(400, 'Invalid JSON body.');
  }

  const { text, deckName } = body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    return error(400, '`text` field is required and must be a non-empty string.');
  }
  if (text.length > MAX_BODY_BYTES) {
    return error(413, '`text` is too long. Max 64 000 characters.');
  }

  // ── Build prompt ────────────────────────────────────────────────
  const nameHint = (typeof deckName === 'string' && deckName.trim())
    ? ` called "${deckName.trim().slice(0, 80)}"`
    : '';

  const prompt = `You are an expert Magic: The Gathering deck builder specialising in Commander/EDH.

Here is a Commander deck${nameHint}:

${text}

Analyse this deck and provide card recommendations. Respond with valid JSON only — no markdown fences, no extra text — matching exactly this schema:

{
  "theme": "<1–2 sentence description of the deck's strategy/theme>",
  "analysis": "<2–3 sentences on strengths and weaknesses>",
  "recommendations": [
    {
      "name": "<exact MTG card name>",
      "reason": "<1–2 sentences on why this card improves the deck>",
      "role": "<one of: ramp, draw, removal, counterspell, board-wipe, tutor, synergy, utility>",
      "replaces": "<optional: exact name of a card already in the deck this could replace>"
    }
  ]
}

Requirements:
- Provide exactly 6 recommendations.
- Use only real, existing MTG card names spelled exactly correctly.
- Focus on high-impact upgrades that align with the deck's colour identity and theme.
- Omit the "replaces" field entirely if you have no strong suggestion.`;

  // ── Call Claude via Vercel AI SDK ───────────────────────────────
  let result;
  try {
    const anthropic = createAnthropic({ apiKey });

    const { text: rawText } = await generateText({
      model:     anthropic('claude-opus-4-6'),
      prompt,
      maxTokens: 2048,
    });

    result = parseJsonResponse(rawText);
  } catch (err) {
    const msg = err?.message ?? '';
    if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
      return error(502, 'AI service authentication failed. Check your ANTHROPIC_API_KEY.');
    }
    if (msg.includes('429') || msg.includes('rate')) {
      return error(429, 'AI service rate limit reached. Please wait a moment and try again.');
    }
    if (msg.includes('JSON') || msg.includes('parse')) {
      return error(502, 'AI returned an unexpected response format. Please try again.');
    }
    console.error('recommend error:', msg);
    return error(502, 'AI service error. Please try again.');
  }

  // Basic structural validation
  if (
    typeof result.theme !== 'string' ||
    typeof result.analysis !== 'string' ||
    !Array.isArray(result.recommendations)
  ) {
    return error(502, 'AI response was missing required fields. Please try again.');
  }

  // Sanitise each recommendation
  result.recommendations = result.recommendations
    .filter(r => typeof r.name === 'string' && r.name.trim())
    .map(r => ({
      name:    r.name.trim(),
      reason:  typeof r.reason === 'string' ? r.reason.trim() : '',
      role:    typeof r.role   === 'string' ? r.role.trim()   : 'utility',
      ...(typeof r.replaces === 'string' && r.replaces.trim()
          ? { replaces: r.replaces.trim() }
          : {}),
    }));

  return Response.json(result, {
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse JSON from Claude's response, stripping markdown fences if present. */
function parseJsonResponse(raw) {
  // Direct parse
  try { return JSON.parse(raw); } catch {}

  // Strip ```json ... ``` fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }

  // Grab outermost { ... }
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }

  throw new Error('JSON parse failed');
}

function error(status, message) {
  return Response.json(
    { error: message },
    { status, headers: { 'Content-Type': 'application/json', ...CORS } },
  );
}
