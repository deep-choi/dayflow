<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Duckm0yaNKJzyW14PA3wGBNf9fiWBNJh

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Server-side AI automation

For AI diary generation while the browser is closed, see:

- [docs/SERVER_AI_AUTOMATION.md](docs/SERVER_AI_AUTOMATION.md)

## Deployment (Default)

- Primary deploy target: Firebase Hosting (`life-a01e2`)
- Build: `npm run build`
- Deploy: `npx firebase deploy --only hosting`
- Hosting URL: `https://life-a01e2.web.app`

Note: `npm run deploy` currently publishes to `gh-pages`. Firebase is the default operational deploy target.
