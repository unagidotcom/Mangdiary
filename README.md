# MangDiary

A mobile-first AI journal that opens directly to today's private entry.

## Setup

1. Create a Supabase project and run `supabase/schema.sql`.
2. Copy `.env.example` to `.env.local`.
3. Fill `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `GEMINI_API_KEY`.
4. Run:

```bash
npm install
npm run dev
```

Gemini calls and real dream matching are routed through Vercel serverless endpoints in `api/` so the browser never receives provider or service-role keys. For production, add `SUPABASE_SERVICE_ROLE_KEY` in Vercel environment variables; it is required for real cross-user dream matching and makes the unload/beacon save endpoint more reliable. Never expose that value with a `VITE_` prefix.

To fail over across multiple provider keys, add comma-separated server-only values in Vercel:

```bash
GEMINI_API_KEYS=first_key,second_key
```

The single-key variable (`GEMINI_API_KEY`) still works and is tried before the list values.
