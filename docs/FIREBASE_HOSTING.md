# Firebase Hosting Deployment

Dayflow is deployed with Firebase Hosting.

## Target

- Firebase project: `life-a01e2`
- Hosting target: `app` -> `dayflow`
- Hosting public directory: `dist`
- Default hosting URL: `https://dayflow.web.app`
- Config files: `.firebaserc`, `firebase.json`

If a custom domain is connected in the Firebase console, the same Firebase Hosting release is served from that domain.

## Commands

Use this command for the full production deploy:

```bash
npm run deploy
```

That runs:

```bash
npm run build && firebase deploy --only hosting:app
```

Use this only when checking the production bundle locally:

```bash
npm run build
```

Build creates the `dist` files on this machine. Deploy uploads those files to Firebase Hosting and releases them to the live site.

## Notes

- `dist` is the deployed artifact directory.
- `firebase.json` rewrites all routes to `/index.html` for the React app.
- Hosting headers disable aggressive caching so UI updates propagate quickly.
- The production hosting target is configured as `app` and points to `dayflow`.
