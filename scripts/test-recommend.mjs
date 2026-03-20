/**
 * scripts/test-recommend.mjs
 *
 * Smoke-tests the /api/deck/recommend logic against the real Anthropic API.
 * Reads ANTHROPIC_API_KEY from the environment (or a local .env.local file).
 *
 * Usage:
 *   node scripts/test-recommend.mjs
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/test-recommend.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

// ── Load .env.local if present ───────────────────────────────────
const envPath = resolve(import.meta.dirname, '../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey || !apiKey.startsWith('sk-')) {
  console.error('\n❌  ANTHROPIC_API_KEY not set.');
  console.error('    Create .env.local with:  ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}

// ── Sample deck (Commander + 10 cards) ──────────────────────────
const SAMPLE_DECK = `Commander (1)
1 Atraxa, Praetors' Voice

Deck (10)
1 Sol Ring
1 Command Tower
1 Arcane Signet
1 Cultivate
1 Kodama's Reach
1 Rhystic Study
1 Swords to Plowshares
1 Wrath of God
1 Demonic Tutor
1 Brainstorm`;

// ── Build prompt (same logic as the edge function) ───────────────
function buildPrompt(text, deckName) {
  const nameHint = deckName ? ` called "${deckName}"` : '';
  return `You are an expert Magic: The Gathering deck builder specialising in Commander/EDH.

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
}

// ── JSON parser (same as edge function) ──────────────────────────
function parseJsonResponse(raw) {
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch {} }
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch {} }
  throw new Error('JSON parse failed — raw output:\n' + raw.slice(0, 500));
}

// ── Run test ─────────────────────────────────────────────────────
console.log('\n🔮 Testing AI recommendations endpoint…');
console.log('   Model: claude-opus-4-6');
console.log('   Deck:  Atraxa, Praetors\' Voice (10-card sample)\n');

const t0 = Date.now();

try {
  const anthropic = createAnthropic({ apiKey });

  const { text: rawText } = await generateText({
    model:     anthropic('claude-opus-4-6'),
    prompt:    buildPrompt(SAMPLE_DECK, "Atraxa Proliferate"),
    maxTokens: 2048,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`⏱  Response received in ${elapsed}s\n`);

  const result = parseJsonResponse(rawText);

  // Validate structure
  if (typeof result.theme !== 'string')     throw new Error('Missing `theme`');
  if (typeof result.analysis !== 'string')  throw new Error('Missing `analysis`');
  if (!Array.isArray(result.recommendations)) throw new Error('Missing `recommendations`');

  // Print results
  console.log(`🎯 Theme: ${result.theme}\n`);
  console.log(`🔬 Analysis: ${result.analysis}\n`);
  console.log(`✨ Recommendations (${result.recommendations.length}):`);

  for (const r of result.recommendations) {
    console.log(`\n  [${(r.role ?? 'utility').padEnd(13)}] ${r.name}`);
    console.log(`               ${r.reason}`);
    if (r.replaces) console.log(`               → Replaces: ${r.replaces}`);
  }

  console.log('\n✅  Test passed!\n');
  process.exit(0);

} catch (err) {
  console.error('\n❌  Test failed:', err.message ?? err);
  process.exit(1);
}
