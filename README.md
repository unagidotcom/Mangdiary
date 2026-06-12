# MangDiary

A mobile-first AI journal that opens directly to today's private entry.

## Setup

1. Create a Supabase project and run `supabase/schema.sql`.
2. Copy `.env.example` to `.env.local`.
3. Fill `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, and optionally `OPENAI_API_KEY`.
4. Run:

```bash
npm install
npm run dev
```

Gemini/OpenAI calls are routed through Vercel serverless endpoints in `api/` so the browser never receives provider API keys. For production, add `SUPABASE_SERVICE_ROLE_KEY` in Vercel environment variables to make the unload/beacon save endpoint more reliable; never expose that value with a `VITE_` prefix.
