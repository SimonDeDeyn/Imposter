# 🕵️ Imposter

A social deduction party game. Everyone gets the same secret word — except the
imposters. Say a linked word each round, then vote out whoever sounds off.

- **Civilians** get the real word.
- **Undercovers** get a slightly different word — *and don't know they're not civilians*.
- **Spy** gets no word at all and has to bluff.
- A randomly assigned **Mayor** ⚖️ breaks tied votes.
- Civilians win when every imposter is gone. Imposters win when they equal or
  outnumber the civilians.

500 words across 11 categories, each round picks a fresh pair.

## Modes

- **One device — pass & play:** add names, pass the phone around for private
  reveals, discuss and vote out loud, then tap who got eliminated.
- **Multi-device:** host creates a room code, others join, everyone sees
  their card and votes on their own screen.

  > 📡 **Cross-phone sync** works when a Firebase Realtime Database URL is
  > configured (see *"Cross-device play"* below). Without it, the app falls back
  > to `localStorage` — which only syncs across **tabs/windows on the same
  > browser/computer** (fine for local testing, not across separate phones).

## Run it locally

You need [Node.js](https://nodejs.org) 18+ installed. Then:

```bash
npm install      # install dependencies (first time only)
npm run dev      # start the dev server
```

Open the URL it prints (usually http://localhost:5173).

To try multi-device locally, open that URL in two or more browser tabs/windows —
host in one, join with the code in the others.

Other commands:

```bash
npm run build    # production build into dist/
npm run preview  # preview the production build
```

## Project structure

```
index.html        # entry HTML (loads Tailwind via CDN)
src/
  main.jsx        # React entry point
  App.jsx         # the entire game (dictionary, UI, both modes)
vite.config.js    # Vite + React config
```

Everything lives in `src/App.jsx`. The word list is the `DICT` object near the
top — add or edit pairs there. Each pair is `["CivilianWord", "UndercoverWord"]`;
which one becomes which is randomized each game.

## Cross-device play (real phones)

The multi-device layer talks to a small storage object called `S` in
`src/App.jsx` (methods: `get`, `set`, `del`, `list`). It has two backends and
picks automatically:

- **Firebase Realtime Database** (`RemoteStore`) — used when the env var
  `VITE_FIREBASE_DB_URL` is set. Talks to Firebase over its plain REST API (no
  SDK, no extra dependency). This is what makes separate phones sync.
- **localStorage** (`LocalStore`) — the zero-config fallback when no URL is set.
  Same-browser only.

### Set it up

1. Create a free project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Build → Realtime Database → Create database** (pick a region, start in test
   mode or use the rules below).
3. Copy the database URL shown at the top of the Data tab, e.g.
   `https://your-project-default-rtdb.europe-west1.firebasedatabase.app`.
4. Put it in `.env.local` (copy from [.env.example](.env.example)) for local dev,
   and add the same `VITE_FIREBASE_DB_URL` variable in your host's dashboard
   (Vercel → Settings → Environment Variables), then redeploy.

Suggested security rules (scopes read/write to game rooms only):

```json
{
  "rules": {
    "imposter": {
      "$code": { ".read": true, ".write": true }
    }
  }
}
```

> Rooms are ephemeral and hold no personal data beyond first names. The host
> deletes the room on close; abandoned rooms can be cleared manually in the
> Firebase console.

## License

MIT — see [LICENSE](LICENSE).
