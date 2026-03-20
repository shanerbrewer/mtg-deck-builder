/**
 * GET /api/health
 *
 * Returns service status and available endpoints.
 * Useful for uptime checks and API discovery.
 */

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  return Response.json(
    {
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      endpoints: [
        { method: 'GET',  path: '/api/health',          description: 'Service status' },
        { method: 'POST', path: '/api/deck/parse',      description: 'Parse a decklist into structured JSON' },
        { method: 'POST', path: '/api/deck/validate',   description: 'Validate a Commander decklist' },
      ],
    },
    { headers: { 'Content-Type': 'application/json', ...CORS } },
  );
}
