import { useState, useEffect, useRef } from "react";
import { TOTAL_WORDS, CATEGORIES, ALL_CATEGORIES, pairsForCategory } from "./words.js";

/* ================================================================
   IMPOSTER — social deduction party game
   Civilians get the secret word, Undercovers get a near-miss word
   (and don't know it), the Spy gets nothing. Talk. Vote. Survive.
   ================================================================ */

/* Word list, categories & helpers live in ./words.js */

/* ---------------- Theme ---------------- */
const C = {
  bg: "#14121F", surface: "#1E1A31", surface2: "#2A2547", line: "#3A3363",
  text: "#EFEAFE", dim: "#9C94C2",
  amber: "#FFC24B", amberDark: "#2A2008",
  coral: "#FF5A6E", mint: "#3DDC97", sky: "#6FB6FF", purple: "#B78CFF",
};

const ROLE = {
  civilian:   { label: "Civilian",   color: C.sky,    desc: "You know the real word." },
  undercover: { label: "Undercover", color: C.purple, desc: "You got a slightly different word (and don't know it)." },
  spy:        { label: "Spy",        color: C.coral,  desc: "You have no word. Blend in and survive." },
};

/* ---------------- Utils ---------------- */
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const uid = () => Math.random().toString(36).slice(2, 9);
const roomCode = () => {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
};

function buildGame(names, settings) {
  // names: [{id, name}] ; settings: {uc, spies, revealTeam, category}
  const pool = pairsForCategory(settings.category);
  const pair = pool[Math.floor(Math.random() * pool.length)];
  const flip = Math.random() < 0.5;
  const civWord = flip ? pair.a : pair.b;
  const ucWord = flip ? pair.b : pair.a;
  const order = shuffle(names.map((n) => n.id));
  const roles = {};
  order.slice(0, settings.uc).forEach((id) => (roles[id] = "undercover"));
  order.slice(settings.uc, settings.uc + settings.spies).forEach((id) => (roles[id] = "spy"));
  const players = names.map((n) => ({
    id: n.id,
    name: n.name,
    isHost: !!n.isHost,
    role: roles[n.id] || "civilian",
    word: roles[n.id] === "spy" ? null : roles[n.id] === "undercover" ? ucWord : civWord,
    alive: true,
  }));
  const mayorId = players[Math.floor(Math.random() * players.length)].id;
  return {
    players,
    mayorId,
    secret: { civWord, ucWord, cat: pair.cat },
    order: shuffle(players.map((p) => p.id)),
    round: 1,
  };
}

function winnerOf(players) {
  const alive = players.filter((p) => p.alive);
  const imp = alive.filter((p) => p.role !== "civilian").length;
  const civ = alive.length - imp;
  if (imp === 0) return "civilians";
  if (imp >= civ) return "imposters";
  return null;
}

const teammatesOf = (players, meId) =>
  players.filter((p) => p.id !== meId && p.role !== "civilian").map((p) => p.name);

// Firebase's Realtime Database omits empty arrays (an empty array reads back as
// null/undefined). Guests read state from there, so restore the array fields to
// real arrays before the UI touches them — otherwise `st.players.find(...)` etc.
// throws on an undefined value and blanks the screen.
const normalizeState = (s) =>
  s ? { ...s, players: s.players || [], lobby: s.lobby || [], order: s.order || [] } : s;

/* ---------------- Shared storage helpers (multi-device) ---------------- */
const K = {
  state: (code) => `imposter:${code}:state`,
  player: (code, id) => `imposter:${code}:p:${id}`,
  prefix: (code) => `imposter:${code}:p:`,
};
// Firebase Realtime Database URL, e.g. https://xxxx-default-rtdb.firebaseio.com
// Set VITE_FIREBASE_DB_URL in a .env file (local) and in your host's env vars
// (Vercel → Project → Settings → Environment Variables).
// When present, rooms sync across REAL devices. When absent, we fall back to
// localStorage (same-browser only) so local dev works with zero config.
const DB_URL = (import.meta.env.VITE_FIREBASE_DB_URL || "").replace(/\/+$/, "");
const REMOTE = !!DB_URL;

// Our keys are colon-delimited; Firebase wants path segments. Map between them:
//   imposter:CODE:state -> imposter/CODE/state
//   imposter:CODE:p:ID  -> imposter/CODE/p/ID
const toPath = (key) => key.replace(/:/g, "/");
const dbUrl = (key) => `${DB_URL}/${toPath(key)}.json`;

// Remote store: Firebase Realtime Database over its plain REST API (no SDK).
// Same get/set/del/list contract as the local store, so nothing else changes.
const RemoteStore = {
  async get(k) {
    try {
      const r = await fetch(dbUrl(k));
      if (!r.ok) return null;
      const v = await r.json();
      return v ?? null;
    } catch { return null; }
  },
  async set(k, v) {
    try {
      const r = await fetch(dbUrl(k), { method: "PUT", body: JSON.stringify(v) });
      return r.ok;
    } catch { return false; }
  },
  async del(k) {
    try {
      const r = await fetch(dbUrl(k), { method: "DELETE" });
      return r.ok;
    } catch { return false; }
  },
  async list(prefix) {
    // prefix "imposter:CODE:p:" -> list child keys under imposter/CODE/p
    const parent = toPath(prefix).replace(/\/+$/, "");
    try {
      const r = await fetch(`${DB_URL}/${parent}.json?shallow=true`);
      if (!r.ok) return [];
      const obj = await r.json();
      if (!obj) return [];
      return Object.keys(obj).map((id) => `${prefix}${id}`);
    } catch { return []; }
  },
};

// Local store: localStorage-backed. Works across tabs/windows on the SAME
// browser only — used automatically when no Firebase URL is configured.
const LocalStore = {
  _read() {
    try { return JSON.parse(localStorage.getItem("imposter:store") || "{}"); }
    catch { return {}; }
  },
  _write(obj) {
    try {
      localStorage.setItem("imposter:store", JSON.stringify(obj));
      // Nudge same-tab listeners (storage event only fires in OTHER tabs).
      window.dispatchEvent(new Event("imposter:local"));
      return true;
    } catch { return false; }
  },
  async get(k) { const o = this._read(); return k in o ? o[k] : null; },
  async set(k, v) { const o = this._read(); o[k] = v; return this._write(o); },
  async del(k) { const o = this._read(); delete o[k]; return this._write(o); },
  async list(prefix) {
    const o = this._read();
    return Object.keys(o).filter((k) => k.startsWith(prefix));
  },
};

const S = REMOTE ? RemoteStore : LocalStore;

const storageAvailable = () => {
  if (REMOTE) return true;
  try {
    localStorage.setItem("imposter:test", "1");
    localStorage.removeItem("imposter:test");
    return true;
  } catch { return false; }
};

/* ---------------- Base UI ---------------- */
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&family=Outfit:wght@300..800&display=swap');
      .imp-root { font-family: 'Outfit', system-ui, sans-serif; }
      .imp-display { font-family: 'Bricolage Grotesque', 'Outfit', system-ui, sans-serif; }
      .imp-btn { transition: transform .08s ease, filter .15s ease, opacity .15s ease; }
      .imp-btn:active { transform: scale(.97); }
      .imp-btn:focus-visible { outline: 3px solid ${C.amber}; outline-offset: 2px; }
      input.imp-input:focus-visible { outline: 3px solid ${C.amber}; outline-offset: 1px; }
      @media (prefers-reduced-motion: no-preference) {
        .imp-flip-in { animation: impFlip .45s ease both; }
        .imp-pop { animation: impPop .35s cubic-bezier(.2,1.4,.4,1) both; }
        .imp-pulse { animation: impPulse 2.4s ease-in-out infinite; }
        @keyframes impFlip { from { transform: rotateY(90deg); opacity: 0; } to { transform: rotateY(0deg); opacity: 1; } }
        @keyframes impPop { from { transform: scale(.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes impPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
      }
    `}</style>
  );
}

function Shell({ children, tone }) {
  const glow =
    tone === "safe" ? "rgba(61,220,151,.16)" :
    tone === "danger" ? "rgba(255,90,110,.16)" :
    "rgba(255,194,75,.07)";
  return (
    <div className="imp-root min-h-screen w-full flex justify-center" style={{ background: C.bg, color: C.text }}>
      <GlobalStyle />
      <div className="w-full flex flex-col px-5 py-6 relative" style={{ maxWidth: 460, minHeight: "100vh" }}>
        <div aria-hidden="true" style={{
          position: "fixed", inset: 0, pointerEvents: "none",
          background: `radial-gradient(600px 340px at 50% -80px, ${glow}, transparent 70%)`,
        }} />
        <div className="relative flex flex-col flex-1">{children}</div>
      </div>
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, small, style }) {
  const base = {
    primary: { background: C.amber, color: "#241A02", border: "none" },
    ghost: { background: "transparent", color: C.text, border: `1.5px solid ${C.line}` },
    danger: { background: C.coral, color: "#2B0509", border: "none" },
    mint: { background: C.mint, color: "#03271A", border: "none" },
    dark: { background: C.surface2, color: C.text, border: `1.5px solid ${C.line}` },
  }[variant];
  return (
    <button
      className="imp-btn imp-display w-full rounded-2xl font-bold"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...base,
        padding: small ? "10px 14px" : "15px 18px",
        fontSize: small ? 14 : 17,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: ".01em",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Pill({ children, color, filled }) {
  return (
    <span
      className="imp-display font-bold rounded-full inline-flex items-center"
      style={{
        fontSize: 12, padding: "4px 12px", letterSpacing: ".06em", textTransform: "uppercase",
        color: filled ? "#1A1206" : color,
        background: filled ? color : "transparent",
        border: `1.5px solid ${color}`,
      }}
    >
      {children}
    </span>
  );
}

function TopBar({ title, sub, onBack }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      {onBack && (
        <button
          className="imp-btn rounded-xl flex items-center justify-center"
          onClick={onBack}
          aria-label="Back"
          style={{ width: 40, height: 40, background: C.surface, border: `1.5px solid ${C.line}`, color: C.text, fontSize: 18 }}
        >
          ←
        </button>
      )}
      <div>
        <div className="imp-display font-extrabold" style={{ fontSize: 21, lineHeight: 1.1 }}>{title}</div>
        {sub && <div style={{ color: C.dim, fontSize: 13, marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function Stepper({ label, value, setValue, min, max, hint }) {
  return (
    <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
      <div>
        <div className="font-semibold" style={{ fontSize: 15 }}>{label}</div>
        {hint && <div style={{ color: C.dim, fontSize: 12 }}>{hint}</div>}
      </div>
      <div className="flex items-center gap-3">
        <button className="imp-btn imp-display rounded-xl font-extrabold" aria-label={`Decrease ${label}`}
          onClick={() => setValue(Math.max(min, value - 1))}
          style={{ width: 38, height: 38, background: C.surface2, color: C.text, border: `1.5px solid ${C.line}`, fontSize: 18 }}>−</button>
        <div className="imp-display font-extrabold text-center" style={{ width: 26, fontSize: 20 }}>{value}</div>
        <button className="imp-btn imp-display rounded-xl font-extrabold" aria-label={`Increase ${label}`}
          onClick={() => setValue(Math.min(max, value + 1))}
          style={{ width: 38, height: 38, background: C.surface2, color: C.text, border: `1.5px solid ${C.line}`, fontSize: 18 }}>+</button>
      </div>
    </div>
  );
}

function Toggle({ label, hint, value, setValue }) {
  return (
    <button
      className="imp-btn w-full flex items-center justify-between rounded-2xl px-4 py-3 text-left"
      onClick={() => setValue(!value)}
      style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.text }}
    >
      <div style={{ paddingRight: 12 }}>
        <div className="font-semibold" style={{ fontSize: 15 }}>{label}</div>
        {hint && <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>{hint}</div>}
      </div>
      <div className="rounded-full flex-shrink-0" style={{
        width: 50, height: 28, padding: 3, background: value ? C.mint : C.surface2,
        border: `1.5px solid ${value ? C.mint : C.line}`, transition: "background .2s",
      }}>
        <div className="rounded-full" style={{
          width: 20, height: 20, background: value ? "#03271A" : C.dim,
          transform: value ? "translateX(22px)" : "translateX(0)", transition: "transform .2s",
        }} />
      </div>
    </button>
  );
}

/* Category picker — pick one theme or keep it random across all */
function CategoryPicker({ value, onChange }) {
  const current = value || ALL_CATEGORIES;
  const opts = [ALL_CATEGORIES, ...CATEGORIES];
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
      <div className="font-semibold" style={{ fontSize: 15 }}>Word category</div>
      <div style={{ color: C.dim, fontSize: 12, marginTop: 2, marginBottom: 10 }}>
        Keep it random across everything, or lock the game to one theme.
      </div>
      <div className="flex gap-2 flex-wrap">
        {opts.map((c) => {
          const active = current === c;
          const label = c === ALL_CATEGORIES ? "🎲 Random (all)" : c;
          return (
            <button key={c} type="button" className="imp-btn rounded-full" onClick={() => onChange(c)}
              style={{
                padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: active ? C.amber : C.surface2,
                border: `1.5px solid ${active ? C.amber : C.line}`,
                color: active ? C.amberDark : C.text,
              }}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Settings panel — shared by both modes */
function SettingsPanel({ settings, setSettings, playerCount }) {
  const imposters = settings.uc + settings.spies;
  const civilians = playerCount - imposters;
  const valid = playerCount >= 3 && imposters >= 1 && civilians > imposters;
  return (
    <div className="flex flex-col gap-3">
      <Stepper label="Spies" hint="Get no word at all"
        value={settings.spies} setValue={(v) => setSettings({ ...settings, spies: v })} min={0} max={3} />
      <Stepper label="Undercovers" hint="Get a near-miss word, don't know it"
        value={settings.uc} setValue={(v) => setSettings({ ...settings, uc: v })} min={0} max={5} />
      <Toggle label="Imposters see their teammates"
        hint="Undercovers & spies see who's on their side. Note: this tells Undercovers they are Undercover."
        value={settings.revealTeam} setValue={(v) => setSettings({ ...settings, revealTeam: v })} />
      <div className="flex gap-2 flex-wrap items-center rounded-2xl px-4 py-3" style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
        <Pill color={C.sky}>{Math.max(civilians, 0)} civilian{civilians === 1 ? "" : "s"}</Pill>
        {settings.uc > 0 && <Pill color={C.purple}>{settings.uc} undercover</Pill>}
        {settings.spies > 0 && <Pill color={C.coral}>{settings.spies} spy</Pill>}
      </div>
      {!valid && (
        <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,90,110,.1)", border: `1.5px solid ${C.coral}`, color: C.coral, fontSize: 13 }}>
          {playerCount < 3
            ? "You need at least 3 players."
            : imposters < 1
            ? "Add at least 1 undercover or spy."
            : "Civilians must outnumber imposters at the start."}
        </div>
      )}
      <CategoryPicker value={settings.category}
        onChange={(c) => setSettings({ ...settings, category: c })} />
    </div>
  );
}

/* The reveal card — tap to flip */
function RevealCard({ player, revealTeam, players, onDone, doneLabel }) {
  const [shown, setShown] = useState(false);
  const isSpy = player.role === "spy";
  const showTeam = revealTeam && player.role !== "civilian";
  const mates = showTeam ? teammatesOf(players, player.id) : [];
  // Undercovers who can't see teammates believe they're civilians:
  const label = isSpy ? "Spy" : showTeam && player.role === "undercover" ? "Undercover" : "Civilian";
  const color = isSpy ? C.coral : showTeam && player.role === "undercover" ? C.purple : C.sky;
  return (
    <div className="flex flex-col items-center gap-5 flex-1 justify-center">
      {!shown ? (
        <button
          className="imp-btn imp-display w-full rounded-3xl flex flex-col items-center justify-center gap-3"
          onClick={() => setShown(true)}
          style={{
            minHeight: 320, background: `linear-gradient(160deg, ${C.surface2}, ${C.surface})`,
            border: `2px dashed ${C.amber}`, color: C.text, cursor: "pointer",
          }}
        >
          <div className="imp-pulse" style={{ fontSize: 64 }}>🤫</div>
          <div className="font-extrabold" style={{ fontSize: 22 }}>{player.name}</div>
          <div style={{ color: C.amber, fontSize: 14, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
            Tap to reveal — keep it secret
          </div>
        </button>
      ) : (
        <>
          <div
            className="imp-flip-in w-full rounded-3xl flex flex-col items-center justify-center gap-4 px-6 py-10"
            style={{ minHeight: 320, background: `linear-gradient(160deg, ${C.surface2}, ${C.surface})`, border: `2px solid ${color}` }}
          >
            <Pill color={color} filled>{label}</Pill>
            {isSpy ? (
              <>
                <div className="imp-display font-extrabold text-center" style={{ fontSize: 34, lineHeight: 1.1 }}>
                  You are the Spy
                </div>
                <div className="text-center" style={{ color: C.dim, fontSize: 14, maxWidth: 280 }}>
                  You don't know the word. Listen carefully, blend in, and don't get voted out.
                </div>
              </>
            ) : (
              <>
                <div style={{ color: C.dim, fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase" }}>Your word</div>
                <div className="imp-display font-extrabold text-center" style={{ fontSize: 40, lineHeight: 1.05 }}>{player.word}</div>
              </>
            )}
            {showTeam && (
              <div className="text-center rounded-2xl px-4 py-3 mt-1" style={{ background: "rgba(0,0,0,.25)", border: `1.5px solid ${C.line}` }}>
                <div style={{ fontSize: 12, color: C.dim, textTransform: "uppercase", letterSpacing: ".08em" }}>On your side</div>
                <div className="font-semibold" style={{ fontSize: 15, marginTop: 3 }}>
                  {mates.length ? mates.join(", ") : "No one — you're alone"}
                </div>
              </div>
            )}
          </div>
          <Btn onClick={onDone}>{doneLabel || "Got it — hide my word"}</Btn>
        </>
      )}
    </div>
  );
}

/* ================================================================
   SINGLE DEVICE MODE
   ================================================================ */
function SingleDevice({ goHome }) {
  const [step, setStep] = useState("names"); // names | settings | reveal | mayor | play | eliminate | result | gameover
  const [names, setNames] = useState([]);
  const [input, setInput] = useState("");
  const [settings, setSettings] = useState({ uc: 1, spies: 1, revealTeam: false, category: ALL_CATEGORIES });
  const [game, setGame] = useState(null);
  const [revealIdx, setRevealIdx] = useState(0);
  const [passReady, setPassReady] = useState(false);
  const [pick, setPick] = useState(null);
  const [result, setResult] = useState(null);

  const addName = () => {
    const n = input.trim();
    if (!n) return;
    if (names.some((x) => x.name.toLowerCase() === n.toLowerCase())) return;
    setNames([...names, { id: uid(), name: n }]);
    setInput("");
  };

  const imposters = settings.uc + settings.spies;
  const validSettings = names.length >= 3 && imposters >= 1 && names.length - imposters > imposters;

  const startGame = () => {
    setGame(buildGame(names, settings));
    setRevealIdx(0); setPassReady(false); setResult(null); setPick(null);
    setStep("reveal");
  };

  const eliminate = (id) => {
    const players = game.players.map((p) => (p.id === id ? { ...p, alive: false } : p));
    const victim = game.players.find((p) => p.id === id);
    const win = winnerOf(players);
    let mayorId = game.mayorId, mayorPassed = null;
    if (id === mayorId && !win) {
      const alive = players.filter((p) => p.alive);
      mayorId = alive[Math.floor(Math.random() * alive.length)].id;
      mayorPassed = players.find((p) => p.id === mayorId).name;
    }
    setGame({ ...game, players, mayorId, order: shuffle(players.filter((p) => p.alive).map((p) => p.id)), round: game.round + 1 });
    setResult({ name: victim.name, role: victim.role, correct: victim.role !== "civilian", winner: win, mayorPassed });
    setPick(null);
    setStep("result");
  };

  const nameOf = (id) => game.players.find((p) => p.id === id)?.name;

  // Escape hatches shown during an active game (reveal → gameover)
  const QuitBar = () => {
    const [confirm, setConfirm] = useState(null); // "names" | "menu" | null
    if (confirm) {
      return (
        <div className="rounded-2xl px-4 py-3 mb-4" style={{ background: "rgba(255,90,110,.1)", border: `1.5px solid ${C.coral}` }}>
          <div style={{ fontSize: 14, marginBottom: 10 }}>
            End this game and {confirm === "names" ? "edit the players?" : "go to the main menu?"}
          </div>
          <div className="flex gap-2">
            <Btn small variant="danger" onClick={() => (confirm === "names" ? setStep("names") : goHome())}>
              Yes, quit game
            </Btn>
            <Btn small variant="ghost" onClick={() => setConfirm(null)}>Keep playing</Btn>
          </div>
        </div>
      );
    }
    return (
      <div className="flex gap-2 mb-4">
        <button className="imp-btn flex-1 rounded-xl px-3 py-2 font-semibold" onClick={() => setConfirm("names")}
          style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.dim, fontSize: 13, cursor: "pointer" }}>
          ✎ Edit players
        </button>
        <button className="imp-btn flex-1 rounded-xl px-3 py-2 font-semibold" onClick={() => setConfirm("menu")}
          style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.dim, fontSize: 13, cursor: "pointer" }}>
          ⌂ Main menu
        </button>
      </div>
    );
  };

  /* ---- names ---- */
  if (step === "names") {
    return (
      <Shell>
        <TopBar title="Who's playing?" sub="Add everyone at the table" onBack={goHome} />
        <div className="flex gap-2 mb-3">
          <input
            className="imp-input flex-1 rounded-2xl px-4"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addName()}
            placeholder="Player name"
            style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.text, fontSize: 16, height: 52 }}
          />
          <Btn onClick={addName} small style={{ width: 80, height: 52 }}>Add</Btn>
        </div>
        <div className="flex flex-col gap-2 mb-4">
          {names.map((n, i) => (
            <div key={n.id} className="imp-pop flex items-center justify-between rounded-2xl px-4 py-3"
              style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
              <div className="font-semibold">{i + 1}. {n.name}</div>
              <button className="imp-btn rounded-lg px-2" aria-label={`Remove ${n.name}`}
                onClick={() => setNames(names.filter((x) => x.id !== n.id))}
                style={{ color: C.coral, background: "transparent", border: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
          ))}
          {names.length === 0 && (
            <div className="rounded-2xl px-4 py-6 text-center" style={{ border: `1.5px dashed ${C.line}`, color: C.dim, fontSize: 14 }}>
              No players yet — add at least 3 to start.
            </div>
          )}
        </div>
        <div className="mt-auto">
          <Btn onClick={() => setStep("settings")} disabled={names.length < 3}>
            Continue ({names.length} player{names.length === 1 ? "" : "s"})
          </Btn>
        </div>
      </Shell>
    );
  }

  /* ---- settings ---- */
  if (step === "settings") {
    return (
      <Shell>
        <TopBar title="Game setup" sub={`${names.length} players at the table`} onBack={() => setStep("names")} />
        <SettingsPanel settings={settings} setSettings={setSettings} playerCount={names.length} />
        <div className="mt-auto pt-4">
          <Btn onClick={startGame} disabled={!validSettings}>Deal the words</Btn>
        </div>
      </Shell>
    );
  }

  /* ---- reveal (pass & play) ---- */
  if (step === "reveal") {
    const p = game.players[revealIdx];
    if (!passReady) {
      return (
        <Shell>
          <QuitBar />
          <div className="flex flex-col items-center justify-center flex-1 gap-6 text-center">
            <div style={{ color: C.dim, fontSize: 14, letterSpacing: ".1em", textTransform: "uppercase" }}>
              Player {revealIdx + 1} of {game.players.length}
            </div>
            <div className="imp-display font-extrabold" style={{ fontSize: 36, lineHeight: 1.1 }}>
              Pass the phone to<br /><span style={{ color: C.amber }}>{p.name}</span>
            </div>
            <div style={{ color: C.dim, fontSize: 14 }}>No peeking, everyone else 👀</div>
            <div className="w-full pt-4">
              <Btn onClick={() => setPassReady(true)}>I'm {p.name}</Btn>
            </div>
          </div>
        </Shell>
      );
    }
    return (
      <Shell>
        <TopBar title={`${p.name}, your card`} sub="Reveal, memorize, hide" />
        <RevealCard
          player={p}
          revealTeam={settings.revealTeam}
          players={game.players}
          onDone={() => {
            setPassReady(false);
            if (revealIdx + 1 < game.players.length) setRevealIdx(revealIdx + 1);
            else setStep("mayor");
          }}
        />
      </Shell>
    );
  }

  /* ---- mayor announcement ---- */
  if (step === "mayor") {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center flex-1 gap-5 text-center">
          <div style={{ fontSize: 60 }}>⚖️</div>
          <div className="imp-display font-extrabold" style={{ fontSize: 30, lineHeight: 1.15 }}>
            <span style={{ color: C.amber }}>{nameOf(game.mayorId)}</span> is the Mayor
          </div>
          <div style={{ color: C.dim, fontSize: 15, maxWidth: 300 }}>
            When a vote ends in a tie, the Mayor casts the deciding vote.
          </div>
          <div className="w-full pt-4">
            <Btn onClick={() => setStep("play")}>Start round 1</Btn>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---- play ---- */
  if (step === "play") {
    const alive = game.players.filter((p) => p.alive);
    return (
      <Shell>
        <TopBar title={`Round ${game.round}`} sub="Everyone says one word about their word" />
        <QuitBar />
        <div className="rounded-2xl px-4 py-3 mb-3 flex items-center gap-2" style={{ background: "rgba(255,194,75,.08)", border: `1.5px solid ${C.amber}` }}>
          <span style={{ fontSize: 18 }}>⚖️</span>
          <span style={{ fontSize: 14 }}><b>{nameOf(game.mayorId)}</b> is the Mayor (breaks ties)</span>
        </div>
        <div style={{ color: C.dim, fontSize: 13, letterSpacing: ".08em", textTransform: "uppercase", margin: "6px 0" }}>Speaking order</div>
        <div className="flex flex-col gap-2 mb-4">
          {game.order.map((id, i) => (
            <div key={id} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
              <div className="imp-display font-extrabold" style={{ color: C.amber, width: 22 }}>{i + 1}</div>
              <div className="font-semibold">{nameOf(id)}</div>
              {id === game.mayorId && <span style={{ marginLeft: "auto" }}>⚖️</span>}
            </div>
          ))}
        </div>
        <div style={{ color: C.dim, fontSize: 13, textAlign: "center", marginBottom: 12 }}>
          Discuss and vote out loud — then record the result below.
        </div>
        <div className="mt-auto">
          <Btn onClick={() => setStep("eliminate")} variant="danger">Someone got voted out</Btn>
        </div>
      </Shell>
    );
  }

  /* ---- eliminate picker ---- */
  if (step === "eliminate") {
    const alive = game.players.filter((p) => p.alive);
    return (
      <Shell>
        <TopBar title="Who got voted out?" sub="Tap the eliminated player" onBack={() => setStep("play")} />
        <div className="flex flex-col gap-2">
          {alive.map((p) => (
            <button key={p.id} className="imp-btn rounded-2xl px-4 py-4 text-left font-semibold"
              onClick={() => setPick(p.id)}
              style={{
                background: pick === p.id ? "rgba(255,90,110,.14)" : C.surface,
                border: `2px solid ${pick === p.id ? C.coral : C.line}`, color: C.text, fontSize: 16, cursor: "pointer",
              }}>
              {p.name} {p.id === game.mayorId && "⚖️"}
            </button>
          ))}
        </div>
        <div className="mt-auto pt-4">
          <Btn variant="danger" disabled={!pick} onClick={() => eliminate(pick)}>Confirm elimination</Btn>
        </div>
      </Shell>
    );
  }

  /* ---- result ---- */
  if (step === "result") {
    const good = result.correct;
    return (
      <Shell tone={good ? "safe" : "danger"}>
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center">
          <div className="imp-pop rounded-3xl w-full px-6 py-12 flex flex-col items-center gap-4"
            style={{ background: good ? "rgba(61,220,151,.12)" : "rgba(255,90,110,.12)", border: `2.5px solid ${good ? C.mint : C.coral}` }}>
            <div style={{ fontSize: 62 }}>{good ? "🎯" : "💀"}</div>
            <div className="imp-display font-extrabold" style={{ fontSize: 34, color: good ? C.mint : C.coral }}>
              {good ? "Got one!" : "Wrong call!"}
            </div>
            <div style={{ fontSize: 17 }}>
              <b>{result.name}</b> was {result.role === "civilian" ? "an innocent" : "the"}{" "}
              <b style={{ color: ROLE[result.role].color }}>{ROLE[result.role].label}</b>
            </div>
            {result.mayorPassed && (
              <div style={{ color: C.dim, fontSize: 14 }}>⚖️ The Mayor's sash passes to <b>{result.mayorPassed}</b></div>
            )}
          </div>
          <div className="w-full pt-2">
            <Btn onClick={() => setStep(result.winner ? "gameover" : "play")}>
              {result.winner ? "See the verdict" : `Start round ${game.round}`}
            </Btn>
          </div>
        </div>
      </Shell>
    );
  }

  /* ---- game over ---- */
  if (step === "gameover") {
    const win = result.winner;
    const civWin = win === "civilians";
    return (
      <Shell tone={civWin ? "safe" : "danger"}>
        <div className="flex flex-col items-center gap-4 text-center pt-6">
          <div style={{ fontSize: 64 }}>{civWin ? "🏆" : "🕵️"}</div>
          <div className="imp-display font-extrabold" style={{ fontSize: 34, color: civWin ? C.mint : C.coral, lineHeight: 1.1 }}>
            {civWin ? "Civilians win!" : "Imposters win!"}
          </div>
          <div className="rounded-2xl w-full px-4 py-4" style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
            <div style={{ color: C.dim, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>The words ({game.secret.cat})</div>
            <div className="flex justify-center gap-6 mt-2 flex-wrap">
              <div><Pill color={C.sky}>Civilian</Pill><div className="imp-display font-extrabold mt-1" style={{ fontSize: 20 }}>{game.secret.civWord}</div></div>
              <div><Pill color={C.purple}>Undercover</Pill><div className="imp-display font-extrabold mt-1" style={{ fontSize: 20 }}>{game.secret.ucWord}</div></div>
            </div>
          </div>
          <div className="w-full flex flex-col gap-2">
            {game.players.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-2xl px-4 py-3"
                style={{ background: C.surface, border: `1.5px solid ${C.line}`, opacity: p.alive ? 1 : 0.55 }}>
                <div className="font-semibold">{p.name} {!p.alive && "💀"} {p.id === game.mayorId && "⚖️"}</div>
                <Pill color={ROLE[p.role].color}>{ROLE[p.role].label}</Pill>
              </div>
            ))}
          </div>
          <div className="w-full flex flex-col gap-2 pt-2 pb-4">
            <Btn onClick={startGame}>Play again — same crew</Btn>
            <Btn variant="ghost" onClick={goHome}>Back to menu</Btn>
          </div>
        </div>
      </Shell>
    );
  }

  return null;
}

/* ================================================================
   MULTI DEVICE MODE — host is authoritative, players poll state
   ================================================================ */
function MultiDevice({ role, goHome }) {
  // role: "host" | "join"
  const [step, setStep] = useState("setup"); // setup | joining | game | error
  const [myName, setMyName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [settings, setSettings] = useState({ uc: 1, spies: 1, revealTeam: false, category: ALL_CATEGORIES });
  const [code, setCode] = useState(null);
  const [myId] = useState(uid());
  const [st, setSt] = useState(null);
  const [err, setErr] = useState("");
  const [busyBtn, setBusyBtn] = useState(false);

  const stRef = useRef(null);       // host: authoritative state
  const meRef = useRef({});         // my player-key payload
  const lockRef = useRef(false);

  const isHost = role === "host";

  const writeMe = async (patch) => {
    meRef.current = { ...meRef.current, ...patch };
    await S.set(K.player(code || stRef.current?.code, myId), meRef.current);
  };

  /* ---------- create room (host) ---------- */
  const createRoom = async () => {
    if (!myName.trim()) return;
    setBusyBtn(true);
    const c = roomCode();
    const initial = {
      code: c, phase: "lobby", round: 0, settings,
      players: [], lobby: [{ id: myId, name: myName.trim() }],
      mayorId: null, order: [], secret: null, progress: null,
      tie: null, lastResult: null, winner: null, hostId: myId,
    };
    stRef.current = initial;
    meRef.current = { name: myName.trim() };
    const ok = await S.set(K.state(c), initial);
    await S.set(K.player(c, myId), meRef.current);
    if (!ok) { setErr("Couldn't create the room. Try again."); setBusyBtn(false); return; }
    setCode(c); setSt(initial); setStep("game"); setBusyBtn(false);
  };

  /* ---------- join room (guest) ---------- */
  const joinRoom = async () => {
    const c = codeInput.trim().toUpperCase();
    if (!c || !myName.trim()) return;
    setBusyBtn(true);
    const state = await S.get(K.state(c));
    if (!state) { setErr("Room not found. Check the code with your host."); setBusyBtn(false); return; }
    if (state.phase !== "lobby") { setErr("That game already started. Ask the host for a new room."); setBusyBtn(false); return; }
    meRef.current = { name: myName.trim() };
    await S.set(K.player(c, myId), meRef.current);
    setCode(c); setSt(normalizeState(state)); setStep("game"); setBusyBtn(false);
  };

  /* ---------- host loop: aggregate player keys, advance phases ---------- */
  useEffect(() => {
    if (!isHost || step !== "game" || !code) return;
    let stopped = false;

    const eliminate = (s, targetId, counts) => {
      const victim = s.players.find((p) => p.id === targetId);
      s.players = s.players.map((p) => (p.id === targetId ? { ...p, alive: false } : p));
      let mayorPassed = null;
      const aliveNow = s.players.filter((p) => p.alive);
      if (targetId === s.mayorId && aliveNow.length) {
        s.mayorId = aliveNow[Math.floor(Math.random() * aliveNow.length)].id;
        mayorPassed = s.players.find((p) => p.id === s.mayorId).name;
      }
      s.lastResult = { id: victim.id, name: victim.name, role: victim.role, correct: victim.role !== "civilian", counts: counts || null, mayorPassed };
      s.pendingWinner = winnerOf(s.players);
      s.tie = null;
      s.progress = null;
      s.phase = "result";
    };

    const tick = async () => {
      if (stopped || lockRef.current) return;
      lockRef.current = true;
      try {
        const s = stRef.current;
        if (!s) return;
        const keys = await S.list(K.prefix(s.code));
        const data = {};
        for (const k of keys) {
          const d = await S.get(k);
          if (d && d.name) data[k.split(":").pop()] = d;
        }
        let changed = false;
        const alive = s.players.filter((p) => p.alive);

        if (s.phase === "lobby") {
          const lobby = Object.entries(data)
            .map(([id, d]) => ({ id, name: d.name, joined: d.joined || 0 }))
            .sort((a, b) => (a.id === s.hostId ? -1 : b.id === s.hostId ? 1 : a.name.localeCompare(b.name)))
            .map(({ id, name }) => ({ id, name }));
          if (JSON.stringify(lobby) !== JSON.stringify(s.lobby)) { s.lobby = lobby; changed = true; }
        } else if (s.phase === "reveal" || s.phase === "result") {
          const tok = `${s.phase}-${s.round}`;
          const done = alive.filter((p) => data[p.id] && data[p.id].ready === tok).length;
          if (!s.progress || s.progress.kind !== tok || s.progress.done !== done) {
            s.progress = { kind: tok, done, total: alive.length }; changed = true;
          }
          if (done === alive.length && alive.length > 0) {
            if (s.phase === "reveal") {
              s.phase = "discussion"; s.progress = null;
            } else {
              if (s.pendingWinner) { s.winner = s.pendingWinner; s.phase = "gameover"; }
              else {
                s.round += 1;
                s.order = shuffle(s.players.filter((p) => p.alive).map((p) => p.id));
                s.phase = "discussion"; s.progress = null; s.lastResult = null;
              }
            }
            changed = true;
          }
        } else if (s.phase === "voting") {
          const tok = `vote-${s.round}`;
          const votes = alive
            .map((p) => (data[p.id] && data[p.id].vote && data[p.id].vote.t === tok ? { voter: p.id, target: data[p.id].vote.target } : null))
            .filter(Boolean);
          if (!s.progress || s.progress.kind !== tok || s.progress.done !== votes.length) {
            s.progress = { kind: tok, done: votes.length, total: alive.length }; changed = true;
          }
          if (votes.length === alive.length && alive.length > 0) {
            const counts = {};
            votes.forEach((v) => (counts[v.target] = (counts[v.target] || 0) + 1));
            const max = Math.max(...Object.values(counts));
            const leaders = Object.keys(counts).filter((id) => counts[id] === max);
            if (leaders.length === 1) { eliminate(s, leaders[0], counts); }
            else { s.tie = { tied: leaders, counts }; s.phase = "tiebreak"; s.progress = null; }
            changed = true;
          }
        } else if (s.phase === "tiebreak") {
          const tok = `tiebreak-${s.round}`;
          const md = data[s.mayorId];
          if (md && md.vote && md.vote.t === tok && s.tie && s.tie.tied.includes(md.vote.target)) {
            eliminate(s, md.vote.target, s.tie.counts);
            changed = true;
          }
        }

        if (changed) {
          stRef.current = { ...s };
          setSt({ ...s });
          await S.set(K.state(s.code), s);
        }
      } finally {
        lockRef.current = false;
      }
    };

    const iv = setInterval(tick, 2500);
    tick();
    return () => { stopped = true; clearInterval(iv); };
  }, [isHost, step, code]);

  /* ---------- guest loop: poll state ---------- */
  useEffect(() => {
    if (isHost || step !== "game" || !code) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const state = await S.get(K.state(code));
      if (state) { const ns = normalizeState(state); setSt(ns); stRef.current = ns; }
    };
    const iv = setInterval(tick, 2000);
    tick();
    return () => { stopped = true; clearInterval(iv); };
  }, [isHost, step, code]);

  /* ---------- host actions ---------- */
  const hostMutate = async (fn) => {
    const s = stRef.current;
    fn(s);
    stRef.current = { ...s };
    setSt({ ...s });
    await S.set(K.state(s.code), s);
  };

  const startGame = () =>
    hostMutate((s) => {
      const built = buildGame(s.lobby.map((l) => ({ ...l, isHost: l.id === s.hostId })), s.settings);
      Object.assign(s, built, { phase: "reveal", progress: null });
    });

  const startVoting = () => hostMutate((s) => { s.phase = "voting"; s.progress = null; });

  const closeRoom = async () => {
    const s = stRef.current;
    if (s) {
      await S.del(K.state(s.code));
      for (const p of s.players.length ? s.players : s.lobby) await S.del(K.player(s.code, p.id));
    }
    goHome();
  };

  /* ================= screens ================= */

  if (!storageAvailable()) {
    return (
      <Shell>
        <TopBar title="Multi-device unavailable" onBack={goHome} />
        <div className="rounded-2xl px-4 py-4" style={{ background: C.surface, border: `1.5px solid ${C.coral}`, fontSize: 14 }}>
          Shared storage isn't available here, so devices can't sync. Single-device mode still works perfectly.
        </div>
      </Shell>
    );
  }

  /* ---- setup / join ---- */
  if (step === "setup") {
    return (
      <Shell>
        <TopBar title={isHost ? "Host a room" : "Join a room"} sub={isHost ? "Everyone plays on their own phone" : "Get the code from your host"} onBack={goHome} />
        <div className="flex flex-col gap-3">
          {!isHost && (
            <input className="imp-input rounded-2xl px-4 imp-display font-extrabold tracking-widest text-center uppercase"
              value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="CODE" maxLength={4}
              style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.amber, fontSize: 26, height: 60, letterSpacing: ".3em" }} />
          )}
          <input className="imp-input rounded-2xl px-4"
            value={myName} onChange={(e) => setMyName(e.target.value)}
            placeholder="Your name"
            style={{ background: C.surface, border: `1.5px solid ${C.line}`, color: C.text, fontSize: 16, height: 52 }} />
          {isHost && (
            <>
              <div style={{ color: C.dim, fontSize: 13, marginTop: 4 }}>Game settings (you can see who joined before starting):</div>
              <SettingsPanel settings={settings} setSettings={setSettings} playerCount={99} />
            </>
          )}
          {err && <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,90,110,.1)", border: `1.5px solid ${C.coral}`, color: C.coral, fontSize: 13 }}>{err}</div>}
          <div style={{ color: C.dim, fontSize: 12 }}>
            Room data is stored temporarily in shared storage so devices can sync — use first names only.
          </div>
        </div>
        <div className="mt-auto pt-4">
          <Btn disabled={busyBtn || !myName.trim() || (!isHost && codeInput.length !== 4)} onClick={isHost ? createRoom : joinRoom}>
            {busyBtn ? "One sec…" : isHost ? "Create room" : "Join room"}
          </Btn>
        </div>
      </Shell>
    );
  }

  /* ---- in game ---- */
  if (!st) {
    return (
      <Shell><div className="flex-1 flex items-center justify-center" style={{ color: C.dim }}>Connecting…</div></Shell>
    );
  }

  const me = st.players.find((p) => p.id === myId);
  const nameOf = (id) => st.players.find((p) => p.id === id)?.name || "?";
  const aliveP = st.players.filter((p) => p.alive);
  const iAmDead = me && !me.alive;

  /* lobby */
  if (st.phase === "lobby") {
    const validStart = st.lobby.length >= 3 && st.settings.uc + st.settings.spies >= 1 &&
      st.lobby.length - (st.settings.uc + st.settings.spies) > st.settings.uc + st.settings.spies;
    return (
      <Shell>
        <TopBar title="Waiting room" sub={isHost ? "Share the code, then start" : "Waiting for the host to start"} onBack={isHost ? closeRoom : goHome} />
        <div className="rounded-3xl px-4 py-6 text-center mb-4" style={{ background: C.surface, border: `2px solid ${C.amber}` }}>
          <div style={{ color: C.dim, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase" }}>Room code</div>
          <div className="imp-display font-extrabold" style={{ fontSize: 52, letterSpacing: ".25em", color: C.amber, paddingLeft: ".25em" }}>{st.code}</div>
        </div>
        <div style={{ color: C.dim, fontSize: 13, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
          Players ({st.lobby.length})
        </div>
        <div className="flex flex-col gap-2">
          {st.lobby.map((l) => (
            <div key={l.id} className="imp-pop flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
              <div className="font-semibold">{l.name}{l.id === myId ? " (you)" : ""}</div>
              {l.id === st.hostId && <Pill color={C.amber}>Host</Pill>}
            </div>
          ))}
        </div>
        {isHost && (
          <div className="mt-auto pt-4">
            {!validStart && st.lobby.length >= 3 && (
              <div style={{ color: C.coral, fontSize: 13, textAlign: "center", marginBottom: 8 }}>
                Too many imposters for {st.lobby.length} players — lower the count (room settings were set when creating).
              </div>
            )}
            <Btn onClick={startGame} disabled={!validStart}>
              {st.lobby.length < 3 ? "Need at least 3 players" : "Start the game"}
            </Btn>
          </div>
        )}
      </Shell>
    );
  }

  if (!me) {
    return (
      <Shell>
        <TopBar title="Game in progress" onBack={goHome} />
        <div className="rounded-2xl px-4 py-4" style={{ background: C.surface, border: `1.5px solid ${C.line}`, fontSize: 14 }}>
          This round started without you — ask the host to open a new room after this game.
        </div>
      </Shell>
    );
  }

  const waiting = (label) => (
    <div className="rounded-2xl px-4 py-3 text-center imp-pulse" style={{ background: C.surface, border: `1.5px dashed ${C.line}`, color: C.dim, fontSize: 14 }}>
      {label}{st.progress ? ` (${st.progress.done}/${st.progress.total})` : ""}
    </div>
  );

  /* reveal */
  if (st.phase === "reveal") {
    const tok = `reveal-${st.round}`;
    const done = meRef.current.ready === tok;
    return (
      <Shell>
        <TopBar title="Your secret card" sub="Don't show your screen to anyone" />
        {!done ? (
          <RevealCard player={me} revealTeam={st.settings.revealTeam} players={st.players}
            onDone={async () => { await writeMe({ ready: tok }); setSt({ ...st }); }}
            doneLabel="Got it — I'm ready" />
        ) : (
          <div className="flex-1 flex flex-col justify-center gap-4">
            <div className="text-center" style={{ fontSize: 40 }}>🤐</div>
            {waiting("Waiting for everyone to memorize their word")}
          </div>
        )}
      </Shell>
    );
  }

  /* small word reminder used in discussion & voting */
  const WordReminder = () => {
    const [open, setOpen] = useState(false);
    return (
      <button className="imp-btn w-full rounded-2xl px-4 py-3 text-left" onClick={() => setOpen(!open)}
        style={{ background: C.surface2, border: `1.5px solid ${C.line}`, color: C.text, cursor: "pointer" }}>
        <div className="flex items-center justify-between">
          <span style={{ fontSize: 13, color: C.dim, textTransform: "uppercase", letterSpacing: ".08em" }}>
            {me.role === "spy" ? "Your role" : "Your word"}
          </span>
          <span style={{ fontSize: 14 }}>{open ? "🙈 hide" : "👁 peek"}</span>
        </div>
        {open && (
          <div className="imp-display font-extrabold" style={{ fontSize: 22, marginTop: 4, color: me.role === "spy" ? C.coral : C.text }}>
            {me.role === "spy" ? "You are the Spy — no word" : me.word}
          </div>
        )}
      </button>
    );
  };

  /* discussion */
  if (st.phase === "discussion") {
    return (
      <Shell>
        <TopBar title={`Round ${st.round}`} sub="Say one word each, out loud, in order" />
        <div className="rounded-2xl px-4 py-3 mb-3 flex items-center gap-2" style={{ background: "rgba(255,194,75,.08)", border: `1.5px solid ${C.amber}` }}>
          <span style={{ fontSize: 18 }}>⚖️</span>
          <span style={{ fontSize: 14 }}><b>{nameOf(st.mayorId)}</b> is the Mayor (breaks ties)</span>
        </div>
        {!iAmDead && <div className="mb-3"><WordReminder /></div>}
        <div style={{ color: C.dim, fontSize: 13, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>Speaking order</div>
        <div className="flex flex-col gap-2 mb-4">
          {st.order.map((id, i) => (
            <div key={id} className="flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: id === myId ? "rgba(255,194,75,.09)" : C.surface, border: `1.5px solid ${id === myId ? C.amber : C.line}` }}>
              <div className="imp-display font-extrabold" style={{ color: C.amber, width: 22 }}>{i + 1}</div>
              <div className="font-semibold">{nameOf(id)}{id === myId ? " (you)" : ""}</div>
              {id === st.mayorId && <span style={{ marginLeft: "auto" }}>⚖️</span>}
            </div>
          ))}
        </div>
        {iAmDead && <div className="mb-3 text-center" style={{ color: C.dim, fontSize: 13 }}>💀 You're out — spectating.</div>}
        <div className="mt-auto">
          {isHost ? <Btn variant="danger" onClick={startVoting}>Open the vote</Btn> : waiting("The host opens the vote when discussion ends")}
        </div>
      </Shell>
    );
  }

  /* voting */
  if (st.phase === "voting") {
    const tok = `vote-${st.round}`;
    const myVote = meRef.current.vote && meRef.current.vote.t === tok ? meRef.current.vote.target : null;
    if (iAmDead) {
      return (
        <Shell><TopBar title="Voting…" sub="You're spectating" />
          <div className="flex-1 flex flex-col justify-center">{waiting("The living are voting")}</div>
        </Shell>
      );
    }
    return (
      <Shell>
        <TopBar title="Cast your vote" sub="Who is not one of us?" />
        <div className="mb-3"><WordReminder /></div>
        <div className="flex flex-col gap-2">
          {aliveP.filter((p) => p.id !== myId).map((p) => (
            <button key={p.id} className="imp-btn rounded-2xl px-4 py-4 text-left font-semibold"
              disabled={!!myVote}
              onClick={async () => { await writeMe({ vote: { t: tok, target: p.id } }); setSt({ ...st }); }}
              style={{
                background: myVote === p.id ? "rgba(255,90,110,.14)" : C.surface,
                border: `2px solid ${myVote === p.id ? C.coral : C.line}`,
                color: C.text, fontSize: 16, cursor: myVote ? "default" : "pointer", opacity: myVote && myVote !== p.id ? 0.5 : 1,
              }}>
              {p.name} {p.id === st.mayorId && "⚖️"}
            </button>
          ))}
        </div>
        <div className="mt-auto pt-4">
          {myVote ? waiting("Vote locked in — waiting for the rest") :
            <div style={{ color: C.dim, fontSize: 13, textAlign: "center" }}>Tap a name to lock in your vote.</div>}
        </div>
      </Shell>
    );
  }

  /* tiebreak */
  if (st.phase === "tiebreak") {
    const tok = `tiebreak-${st.round}`;
    const iAmMayor = st.mayorId === myId && !iAmDead;
    const myPick = meRef.current.vote && meRef.current.vote.t === tok ? meRef.current.vote.target : null;
    return (
      <Shell>
        <TopBar title="It's a tie!" sub="The Mayor casts the deciding vote" />
        <div className="rounded-2xl px-4 py-3 mb-4 text-center" style={{ background: "rgba(255,194,75,.08)", border: `1.5px solid ${C.amber}`, fontSize: 14 }}>
          ⚖️ Tied: <b>{st.tie.tied.map(nameOf).join(" vs ")}</b>
        </div>
        {iAmMayor ? (
          <>
            <div style={{ color: C.dim, fontSize: 13, textAlign: "center", marginBottom: 10 }}>You're the Mayor — choose who goes.</div>
            <div className="flex flex-col gap-2">
              {st.tie.tied.map((id) => (
                <button key={id} className="imp-btn rounded-2xl px-4 py-4 text-left font-semibold"
                  disabled={!!myPick}
                  onClick={async () => { await writeMe({ vote: { t: tok, target: id } }); setSt({ ...st }); }}
                  style={{
                    background: myPick === id ? "rgba(255,90,110,.14)" : C.surface,
                    border: `2px solid ${myPick === id ? C.coral : C.line}`, color: C.text, fontSize: 16,
                    cursor: myPick ? "default" : "pointer",
                  }}>
                  {nameOf(id)}
                </button>
              ))}
            </div>
            {myPick && <div className="pt-4">{waiting("Decision made")}</div>}
          </>
        ) : (
          <div className="flex-1 flex flex-col justify-center">{waiting(`${nameOf(st.mayorId)} is deciding`)}</div>
        )}
      </Shell>
    );
  }

  /* result — Safe / Wasted */
  if (st.phase === "result") {
    const r = st.lastResult;
    const tok = `result-${st.round}`;
    const done = meRef.current.ready === tok;
    const wasted = r.id === myId;
    const tone = wasted ? "danger" : "safe";
    const spectator = iAmDead && !wasted;
    return (
      <Shell tone={spectator ? undefined : tone}>
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center">
          <div className="imp-pop rounded-3xl w-full px-6 py-12 flex flex-col items-center gap-4"
            style={{
              background: spectator ? C.surface : wasted ? "rgba(255,90,110,.14)" : "rgba(61,220,151,.12)",
              border: `2.5px solid ${spectator ? C.line : wasted ? C.coral : C.mint}`,
            }}>
            <div style={{ fontSize: 62 }}>{spectator ? "👻" : wasted ? "💀" : "🛡️"}</div>
            <div className="imp-display font-extrabold" style={{ fontSize: 40, color: spectator ? C.dim : wasted ? C.coral : C.mint, letterSpacing: ".02em" }}>
              {spectator ? "Spectating" : wasted ? "WASTED" : "SAFE"}
            </div>
            <div style={{ fontSize: 16 }}>
              <b>{r.name}</b> was voted out — {r.role === "civilian" ? "an innocent" : "the"}{" "}
              <b style={{ color: ROLE[r.role].color }}>{ROLE[r.role].label}</b>
              {r.role === "civilian" ? " 😬" : " 🎯"}
            </div>
            {r.mayorPassed && <div style={{ color: C.dim, fontSize: 13 }}>⚖️ New Mayor: <b>{r.mayorPassed}</b></div>}
          </div>
          <div className="w-full pt-2">
            {!iAmDead || wasted ? (
              !done && me.alive ? (
                <Btn onClick={async () => { await writeMe({ ready: tok }); setSt({ ...st }); }}>Continue</Btn>
              ) : (
                waiting("Waiting for everyone")
              )
            ) : (
              waiting("Waiting for the living to continue")
            )}
          </div>
        </div>
      </Shell>
    );
  }

  /* game over */
  if (st.phase === "gameover") {
    const civWin = st.winner === "civilians";
    const iWon = me && ((civWin && me.role === "civilian") || (!civWin && me.role !== "civilian"));
    return (
      <Shell tone={iWon ? "safe" : "danger"}>
        <div className="flex flex-col items-center gap-4 text-center pt-4 pb-6">
          <div style={{ fontSize: 60 }}>{iWon ? "🏆" : "😵"}</div>
          <div className="imp-display font-extrabold" style={{ fontSize: 32, color: civWin ? C.mint : C.coral, lineHeight: 1.1 }}>
            {civWin ? "Civilians win!" : "Imposters win!"}
          </div>
          <div style={{ color: iWon ? C.mint : C.coral, fontSize: 15, fontWeight: 700 }}>
            {iWon ? "You were on the winning side ✨" : "Better luck next round…"}
          </div>
          <div className="rounded-2xl w-full px-4 py-4" style={{ background: C.surface, border: `1.5px solid ${C.line}` }}>
            <div style={{ color: C.dim, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>The words ({st.secret.cat})</div>
            <div className="flex justify-center gap-6 mt-2 flex-wrap">
              <div><Pill color={C.sky}>Civilian</Pill><div className="imp-display font-extrabold mt-1" style={{ fontSize: 20 }}>{st.secret.civWord}</div></div>
              <div><Pill color={C.purple}>Undercover</Pill><div className="imp-display font-extrabold mt-1" style={{ fontSize: 20 }}>{st.secret.ucWord}</div></div>
            </div>
          </div>
          <div className="w-full flex flex-col gap-2">
            {st.players.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-2xl px-4 py-3"
                style={{ background: C.surface, border: `1.5px solid ${C.line}`, opacity: p.alive ? 1 : 0.55 }}>
                <div className="font-semibold">{p.name}{p.id === myId ? " (you)" : ""} {!p.alive && "💀"}</div>
                <Pill color={ROLE[p.role].color}>{ROLE[p.role].label}</Pill>
              </div>
            ))}
          </div>
          <div className="w-full flex flex-col gap-2 pt-2">
            {isHost ? (
              <Btn variant="ghost" onClick={closeRoom}>Close room & back to menu</Btn>
            ) : (
              <Btn variant="ghost" onClick={goHome}>Back to menu</Btn>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  return <Shell><div className="flex-1 flex items-center justify-center" style={{ color: C.dim }}>Syncing…</div></Shell>;
}

/* ================================================================
   HOME + APP SHELL
   ================================================================ */
function Home({ onPick }) {
  const [showRules, setShowRules] = useState(false);
  return (
    <Shell>
      <div className="flex flex-col items-center text-center gap-2 pt-8 pb-6">
        <div style={{ fontSize: 56 }}>🕵️</div>
        <h1 className="imp-display font-extrabold" style={{ fontSize: 52, lineHeight: 1, letterSpacing: "-.02em" }}>
          IMPOSTER
        </h1>
        <div style={{ color: C.dim, fontSize: 15 }}>One word. One liar. Zero mercy.</div>
        <div className="flex gap-2 pt-1">
          <Pill color={C.amber}>{TOTAL_WORDS} words</Pill>
          <Pill color={C.purple}>{CATEGORIES.length} categories</Pill>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Btn onClick={() => onPick("sd")}>
          📱 One device — pass & play
        </Btn>
        <Btn variant="dark" onClick={() => onPick("host")}>
          📡 Host a multi-device room
        </Btn>
        <Btn variant="dark" onClick={() => onPick("join")}>
          🔑 Join with a room code
        </Btn>
        <Btn variant="ghost" small onClick={() => setShowRules(!showRules)}>
          {showRules ? "Hide the rules" : "How to play"}
        </Btn>
      </div>

      {showRules && (
        <div className="imp-pop rounded-2xl px-4 py-4 mt-3 flex flex-col gap-3" style={{ background: C.surface, border: `1.5px solid ${C.line}`, fontSize: 14, lineHeight: 1.5 }}>
          <div><Pill color={C.sky}>Civilians</Pill><div style={{ marginTop: 4 }}>All get the same secret word.</div></div>
          <div><Pill color={C.purple}>Undercovers</Pill><div style={{ marginTop: 4 }}>Get a slightly different word — and have no idea they're not civilians.</div></div>
          <div><Pill color={C.coral}>Spy</Pill><div style={{ marginTop: 4 }}>Gets no word at all and must bluff.</div></div>
          <div style={{ color: C.dim }}>
            Each round, everyone says one word linked to their word. Then vote out whoever sounds off.
            The Mayor ⚖️ breaks ties. Civilians win when all imposters are gone; imposters win when they
            equal or outnumber the civilians.
          </div>
        </div>
      )}

      <div className="mt-auto pt-6 text-center" style={{ color: C.dim, fontSize: 12 }}>
        Multi-device mode syncs every ~2 seconds — perfect for the couch, not for esports.
      </div>
    </Shell>
  );
}

export default function App() {
  const [view, setView] = useState("home"); // home | sd | host | join
  const goHome = () => setView("home");
  if (view === "sd") return <SingleDevice goHome={goHome} />;
  if (view === "host") return <MultiDevice role="host" goHome={goHome} />;
  if (view === "join") return <MultiDevice role="join" goHome={goHome} />;
  return <Home onPick={setView} />;
}
