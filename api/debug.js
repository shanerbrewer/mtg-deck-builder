export const config = { runtime: 'edge' };

export default function handler() {
  return Response.json({
    AUTH_SECRET:        process.env.AUTH_SECRET        ? `set (${process.env.AUTH_SECRET.length} chars)` : 'MISSING',
    AUTH_GITHUB_ID:     process.env.AUTH_GITHUB_ID     ? `set (${process.env.AUTH_GITHUB_ID.length} chars)` : 'MISSING',
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET ? `set (${process.env.AUTH_GITHUB_SECRET.length} chars)` : 'MISSING',
    AUTH_URL:           process.env.AUTH_URL            ?? 'MISSING',
  });
}
