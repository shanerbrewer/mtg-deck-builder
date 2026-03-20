/**
 * POST /api/deck/recommend
 *
 * Two-pass pipeline — called twice by the client, each invocation runs one
 * model call so neither hits the Edge Function timeout.
 *
 * Pass 1 — analysis (request: { pass: 1, text, deckName? })
 *   Model:   claude-opus-4-6
 *   Returns: { analysis: "<prose>" }
 *
 * Pass 2 — JSON conversion (request: { pass: 2, analysis: "<prose>" })
 *   Model:   claude-haiku-4-5  (formatting-only task, much faster)
 *   Returns: { theme, analysis, recommendations: [{ name, reason, role, replaces? }] }
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

  const anthropic = createAnthropic({ apiKey });
  const { pass } = body ?? {};

  // ── Pass 1: free-form analysis ────────────────────────────────────
  if (pass === 1) {
    const { text, deckName } = body;

    if (typeof text !== 'string' || !text.trim()) {
      return error(400, '`text` is required for pass 1.');
    }
    if (text.length > MAX_BODY_BYTES) {
      return error(413, '`text` is too long. Max 64 000 characters.');
    }

    const nameHint = (typeof deckName === 'string' && deckName.trim())
      ? ` called "${deckName.trim().slice(0, 80)}"`
      : '';

    const prompt = `You are an expert Magic: The Gathering deck builder specialising in Commander/EDH.

Here is a Commander deck${nameHint}:

${text}

Analyse this deck's strategy and identify 6 cards that would meaningfully improve it. For each recommendation, explain why the card fits the deck, what strategic role it fills, and which card already in the deck it could replace (if there is a clear candidate).`;

    try {
      const { text: analysis } = await generateText({
        model:     anthropic('claude-opus-4-6'),
        prompt,
        maxTokens: 2048,
      });
      return Response.json({ analysis }, { headers: CORS });
    } catch (err) {
      return handleApiError(err);
    }
  }

  // ── Pass 2: convert prose to JSON ─────────────────────────────────
  if (pass === 2) {
    const { analysis } = body;

    if (typeof analysis !== 'string' || !analysis.trim()) {
      return error(400, '`analysis` is required for pass 2.');
    }

    const prompt = `Convert the following deck analysis into JSON. Respond with valid JSON only — no markdown fences, no extra text — matching this schema exactly:

{
  "theme": "<1–2 sentence description of the deck's strategy/theme>",
  "analysis": "<2–3 sentences on the deck's strengths and weaknesses>",
  "recommendations": [
    {
      "name": "<exact MTG card name, spelled correctly>",
      "reason": "<1–2 sentences on why this card improves the deck>",
      "role": "<one of: ramp, draw, removal, counterspell, board-wipe, tutor, synergy, utility>",
      "replaces": "<exact name of a card in the deck this replaces — omit the field entirely if none was suggested>"
    }
  ]
}

Requirements:
- Exactly 6 entries in recommendations.
- role must be one of the listed values; choose the closest match.
- Include "replaces" only when the analysis explicitly names a card to cut.
- Card names must be spelled exactly as they appear in the analysis.

Analysis to convert:
${analysis}`;

    let result;
    try {
      const { text: rawJson } = await generateText({
        model:     anthropic('claude-haiku-4-5'),
        prompt,
        maxTokens: 1024,
      });
      result = parseJsonResponse(rawJson);
    } catch (err) {
      return handleApiError(err);
    }

    if (
      typeof result.theme !== 'string' ||
      typeof result.analysis !== 'string' ||
      !Array.isArray(result.recommendations)
    ) {
      return error(502, 'AI response was missing required fields. Please try again.');
    }

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

    return Response.json(result, { headers: CORS });
  }

  return error(400, '`pass` must be 1 or 2.');
}

// ── Helpers ───────────────────────────────────────────────────────────

function handleApiError(err) {
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

function parseJsonResponse(raw) {
  try { return JSON.parse(raw); } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }

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
