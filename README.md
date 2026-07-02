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
- **Multi-device (local):** host creates a room code, others join, everyone sees
  their card and votes on their own screen.

  > ⚠️ **Local sync only.** This version syncs through `localStorage`, which is
  > shared across **tabs/windows on the same browser/computer** — great for
  > testing, but it does **not** sync across separate phones. See
  > *"Going cross-device"* below.

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

## Going cross-device (later)

The multi-device layer talks to a small storage object called `S` in
`src/App.jsx` (methods: `get`, `set`, `del`, `list`). To play across real phones,
swap that object's body for calls to a backend — e.g. Firebase Realtime Database,
Supabase, or a tiny REST server — keeping the same method names. The rest of the
game doesn't need to change.

## License

MIT — see [LICENSE](LICENSE).
