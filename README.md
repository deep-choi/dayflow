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

## Deployment

Firebase Hosting is the only operational deploy target for this app.

- Project: `life-a01e2`
- Hosting target: `app` -> `dayflow`
- Build: `npm run build`
- Deploy: `npm run deploy`
- Hosting URL: `https://dayflow.web.app`

## Android

The Android app reuses the Vite build through Capacitor.

1. Build and sync the web bundle: `npm run android:build`
2. Open the native project: `npm run android:open`
3. Build a release bundle from Android Studio or the `android/` Gradle project.

The Android package ID is currently `com.deepchoi.dayflow`. Google OAuth uses the
native callback `com.deepchoi.dayflow://auth/callback`; add that URL to the
Supabase Auth redirect allow list before testing Google login on a device.

Release signing is intentionally environment-only. Set
`DAYFLOW_UPLOAD_KEYSTORE`, `DAYFLOW_UPLOAD_STORE_PASSWORD`,
`DAYFLOW_UPLOAD_KEY_ALIAS`, and `DAYFLOW_UPLOAD_KEY_PASSWORD` before running
`android\\gradlew.bat :app:clean :app:bundleRelease`. Without those values Gradle
will produce an unsigned test bundle.

For deployment details, see [docs/FIREBASE_HOSTING.md](docs/FIREBASE_HOSTING.md).
