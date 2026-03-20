/**
 * POST /api/deck/recommend
 *
 * Two-pass Claude pipeline:
 *   1. Analysis prompt  — free-form deck evaluation and recommendations,
 *                         no formatting constraints so Claude can focus on quality.
 *   2. Conversion prompt — takes Claude's prose and converts it to the JSON
 *                          schema the UI expects, enforcing all constraints there.
 *
 * Request body:  { "text": "...", "deckName": "optional" }
 * Response:      { theme, analysis, recommendations: [{ name, reason, role, replaces? }] }
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

  const nameHint = (typeof deckName === 'string' && deckName.trim())
    ? ` called "${deckName.trim().slice(0, 80)}"`
    : '';

  const anthropic = createAnthropic({ apiKey });

  // ── Pass 1: free-form analysis ───────────────────────────────────
  // No schema, no requirements list — Claude focuses entirely on the deck.
  const analysisPrompt = `You are an expert Magic: The Gathering deck builder specialising in Commander/EDH.

Here is a Commander deck${nameHint}:

${text}

Analyse this deck's strategy and identify 6 cards that would meaningfully improve it. For each recommendation, explain why the card fits the deck, what strategic role it fills, and which card already in the deck it could replace (if there is a clear candidate).`;

  let analysis;
  try {
    const { text: analysisText } = await generateText({
      model:     anthropic('claude-opus-4-6'),
      prompt:    analysisPrompt,
      maxTokens: 2048,
    });
    analysis = analysisText;
  } catch (err) {
    return handleApiError(err);
  }

  // ── Pass 2: convert prose to JSON ────────────────────────────────
  // Claude's only job here is extraction and formatting — all constraints live here.
  const conversionPrompt = `Convert the following deck analysis into JSON. Respond with valid JSON only — no markdown fences, no extra text — matching this schema exactly:

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
      model:     anthropic('claude-opus-4-6'),
      prompt:    conversionPrompt,
      maxTokens: 1024,
    });
    result = parseJsonResponse(rawJson);
  } catch (err) {
    return handleApiError(err);
  }

  // ── Structural validation ────────────────────────────────────────
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

/** Parse JSON from Claude's response, stripping markdown fences if present. */
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
