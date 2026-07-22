<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Dayflow

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Duckm0yaNKJzyW14PA3wGBNf9fiWBNJh

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`
3. Store the complimentary chat key only as a Supabase secret: `supabase secrets set GEMINI_API_KEY=...`
4. Run the app:
   `npm run dev`

## Server-side AI automation

For AI diary generation while the browser is closed, see:

- [docs/SERVER_AI_AUTOMATION.md](docs/SERVER_AI_AUTOMATION.md)

## Deployment

Firebase Hosting is the only operational deploy target for this app.

- Project: `life-a01e2`
- Hosting target: `app` -> `dayflow`
- Build: `npm run build`
- Deploy: `npm run deploy`
- Hosting URL: `https://dayflow.web.app`

For deployment details, see [docs/FIREBASE_HOSTING.md](docs/FIREBASE_HOSTING.md).
