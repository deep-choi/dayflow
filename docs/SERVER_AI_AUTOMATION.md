# Server AI Automation

This project includes a Supabase Edge Function (`process-ai-triggers`) for server-side AI processing when the browser is closed.

## Prerequisites

1. Supabase CLI (`npx supabase --version`)
2. Supabase personal access token (`SUPABASE_ACCESS_TOKEN`)
3. Linked Supabase project (`supabase/.temp/project-ref`)

## 1) Apply database migrations

```bash
npx supabase db push
```

## 2) Set required Edge Function secret

The function now requires `LS_AI_WORKER_SECRET`. Requests without a matching `x-ls-ai-secret` header are rejected.

```bash
npx supabase secrets set LS_AI_WORKER_SECRET="replace-with-strong-random-secret"
```

## 3) Deploy Edge Function

```bash
npx supabase functions deploy process-ai-triggers
```

## 4) Call the function securely

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/process-ai-triggers" \
  -H "Content-Type: application/json" \
  -H "x-ls-ai-secret: <LS_AI_WORKER_SECRET>" \
  -d "{}"
```

## Common issue: missing access token

If you see `Access token not provided`, authenticate first:

```bash
set SUPABASE_ACCESS_TOKEN=<your-token>
```

Or run:

```bash
npx supabase login
```
