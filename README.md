# 🕵️ Imposter

A social deduction party game. Everyone gets the same secret word — except the
imposters. Say a linked word each round, then vote out whoever sounds off.

- **Civilians** get the real word.
- **Undercovers** get a slightly different word — *and don't know they're not civilians*.
- **Spy** gets no word at all and has to bluff.
- A randomly assigned **Mayor** ⚖️ breaks tied votes.
- Civilians win when every imposter is gone. Imposters win when they equal or
  outnumber the civilians.

2254 words across 16 categories, each round picks a fresh pair. Before starting a
game you can lock to a single category (e.g. *Animals*, *World & Landmarks*, or
*Historical Figures*) or keep it **random across all** categories.

## 📲 Get the app

You can play three ways — all share the same rooms, so app, iPhone, and web
players can play together:

- **Android app:** download the latest APK and install it:
  **➡️ [github.com/SimonDeDeyn/Imposter/releases/latest](https://github.com/SimonDeDeyn/Imposter/releases/latest)**
  (or the direct link
  [imposter.apk](https://github.com/SimonDeDeyn/Imposter/releases/latest/download/imposter.apk)).
  Open it on the phone, allow *install from unknown sources*, and install. A fresh
  build is published here automatically on every update.
- **iPhone / any browser:** open the web app and use **Add to Home Screen**
  (Share button in Safari) to install it like an app.

> **Updating the Android app:** it doesn't auto-update. Grab the latest APK from
> the link above and reinstall. Because these are debug-signed builds, you may
> need to uninstall the old one first.

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
  App.jsx         # the game UI + both modes
  words.js        # the word dictionary (categories → pairs) + helpers
vite.config.js    # Vite + React config
```

The word list lives in `src/words.js` as the `DICT` object — categories mapped to
arrays of pairs. Each pair is `["CivilianWord", "UndercoverWord"]`; which one
becomes which is randomized each game. Add a category by adding a key; add words
by adding pairs. Keep each category meaty (~60+ pairs) so it stays varied when
players lock the game to it. The in-game category picker is built automatically
from the keys of `DICT`.

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

### Security rules

Use the hardened rules in [firebase.rules.json](firebase.rules.json) rather than
leaving the database in open "test mode". Paste them into the Firebase console →
**Realtime Database → Rules → Publish**. They:

- restrict reads/writes to valid room codes (`[A-Z]{4}`) only — no writes to
  arbitrary paths;
- cap player-name and field lengths so a field can't be used to flood the DB;
- reject any unexpected keys.

> Rooms are ephemeral and hold no personal data beyond first names. The host
> deletes the room on close; abandoned rooms can be cleared manually in the
> Firebase console. Keep the project on the free **Spark** plan (no billing) so
> usage is capped and can never generate a charge.

## License

MIT — see [LICENSE](LICENSE).
