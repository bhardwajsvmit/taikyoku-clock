// Taikyoku Clock — two-player game clock for Go, chess and other board games.
// Compiled with `node build.mjs` and inlined into a single HTML page.

type Mode = "absolute" | "fischer" | "bronstein" | "delay" | "japanese" | "canadian" | "hourglass";
type AlertMethod = "off" | "beep" | "voice";
type Theme = "auto" | "wood" | "sakura" | "ocean" | "contrast" | "light" | "dark";
type Side = 0 | 1; // 0 = top/left player, 1 = bottom/right player
type Layout = "auto" | "facing" | "upright";
type Haptic = "tap" | "tick" | "warn" | "period" | "flag";

/** One extra time stage: once a player completes `afterMoves` moves, `addSec` is added to their main time. */
interface Stage { afterMoves: number; addSec: number }

/** Hooks provided by the native iOS/iPadOS shell (www/native.js). Absent in a browser. */
interface NativeBridge {
  haptic(kind: Haptic): void;
  keepAwake(on: boolean): void;
}
interface Window { taikyokuNative?: NativeBridge }

interface Config {
  mode: Mode;
  mainSec: number;
  extraSec: number; // increment / delay seconds
  periods: number; // Japanese byo-yomi periods
  stones: number; // Canadian stones per period
  periodSec: number; // byo-yomi period length
  hcOn: boolean;
  hcPlayer: Side;
  hcSec: number;
  stages: Stage[]; // multi-stage controls, e.g. 90 min for 40 moves then +30 min
}

interface Prefs {
  threshold: number;
  alert: AlertMethod;
  lang: string;
  vibrate: boolean;
  tapHaptic: boolean;
  theme: Theme;
  layout: Layout;
}

interface Preset { name: string; cfg: Config; builtin?: boolean }

interface Player {
  main: number; // ms
  delay: number; // ms of free delay left this turn (simple delay)
  usedThisTurn: number; // ms of main time used this turn (Bronstein)
  overtime: boolean;
  periodsLeft: number;
  period: number; // ms left in current byo-yomi period
  stonesLeft: number;
  moves: number;
  flagged: boolean;
  lastSpoken: number;
  warned: boolean;
  turnMs: number; // wall time spent on the current move
  lastMoveMs: number; // how long the previous move took (-1 = none yet)
  stageIdx: number; // next entry of cfg.stages still to be reached
}

// ---------- persistence ----------
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch { return fallback; }
  },
  getArr<T>(key: string): T[] {
    try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

const BASE: Config = { mode: "fischer", mainSec: 300, extraSec: 3, periods: 5, stones: 25, periodSec: 30, hcOn: false, hcPlayer: 1, hcSec: 300, stages: [] };
const mk = (c: Partial<Config>): Config => ({ ...BASE, ...c });

const BUILTIN: Preset[] = [
  { name: "Go · 30m + 5×30s", cfg: mk({ mode: "japanese", mainSec: 1800, periods: 5, periodSec: 30 }), builtin: true },
  { name: "Go · 10m + 3×30s", cfg: mk({ mode: "japanese", mainSec: 600, periods: 3, periodSec: 30 }), builtin: true },
  { name: "Go · 20m + 25/5m Canadian", cfg: mk({ mode: "canadian", mainSec: 1200, stones: 25, periodSec: 300 }), builtin: true },
  { name: "Blitz 3+2", cfg: mk({ mode: "fischer", mainSec: 180, extraSec: 2 }), builtin: true },
  { name: "Blitz 5+3", cfg: mk({ mode: "fischer", mainSec: 300, extraSec: 3 }), builtin: true },
  { name: "Rapid 15+10", cfg: mk({ mode: "fischer", mainSec: 900, extraSec: 10 }), builtin: true },
  { name: "Classical 90+30", cfg: mk({ mode: "fischer", mainSec: 5400, extraSec: 30 }), builtin: true },
  { name: "FIDE 90/40 + 30m, +30s", cfg: mk({ mode: "fischer", mainSec: 5400, extraSec: 30, stages: [{ afterMoves: 40, addSec: 1800 }] }), builtin: true },
  { name: "Classical 2h/40 + 1h/20 + 30m", cfg: mk({ mode: "absolute", mainSec: 7200, stages: [{ afterMoves: 40, addSec: 3600 }, { afterMoves: 60, addSec: 1800 }] }), builtin: true },
  { name: "US 40/120, G/60 d5", cfg: mk({ mode: "delay", mainSec: 7200, extraSec: 5, stages: [{ afterMoves: 40, addSec: 3600 }] }), builtin: true },
  { name: "Shogi 10m + 30s", cfg: mk({ mode: "japanese", mainSec: 600, periods: 1, periodSec: 30 }), builtin: true },
  { name: "Bronstein 5|3", cfg: mk({ mode: "bronstein", mainSec: 300, extraSec: 3 }), builtin: true },
  { name: "US delay G/30 d5", cfg: mk({ mode: "delay", mainSec: 1800, extraSec: 5 }), builtin: true },
  { name: "Hourglass 1m", cfg: mk({ mode: "hourglass", mainSec: 60 }), builtin: true },
  { name: "Sudden death 5m", cfg: mk({ mode: "absolute", mainSec: 300 }), builtin: true },
];

let cfg: Config = store.get<Config>("tk.cfg", BUILTIN[0].cfg);
if (!Array.isArray(cfg.stages)) cfg.stages = [];
let prefs: Prefs = store.get<Prefs>("tk.prefs", { threshold: 10, alert: "voice", lang: "", vibrate: true, tapHaptic: true, theme: "auto", layout: "auto" });
let custom: Preset[] = store.getArr<Preset>("tk.presets");

// ---------- clock engine ----------
const players: [Player, Player] = [newPlayer(0), newPlayer(1)];
let active: Side | -1 = -1; // whose clock is running (or paused on)
let running = false;
let lastTs = 0;

function newPlayer(i: Side): Player {
  const main = cfg.mainSec * 1000 + (cfg.hcOn && cfg.hcPlayer === i ? cfg.hcSec * 1000 : 0);
  const p: Player = { main, delay: 0, usedThisTurn: 0, overtime: false, periodsLeft: cfg.periods, period: cfg.periodSec * 1000,
    stonesLeft: cfg.stones, moves: 0, flagged: false, lastSpoken: Infinity, warned: false, turnMs: 0, lastMoveMs: -1, stageIdx: 0 };
  if (main <= 0 && isByoyomi()) enterOvertime(p);
  return p;
}

const isByoyomi = (): boolean => cfg.mode === "japanese" || cfg.mode === "canadian";

function enterOvertime(p: Player): void {
  p.overtime = true;
  p.main = 0;
  p.periodsLeft = cfg.periods;
  p.stonesLeft = cfg.stones;
  p.period = cfg.periodSec * 1000;
  p.lastSpoken = Infinity;
  p.warned = false;
}

function startTurn(i: Side): void {
  const p = players[i];
  p.delay = cfg.mode === "delay" ? cfg.extraSec * 1000 : 0;
  p.usedThisTurn = 0;
  p.turnMs = 0;
  p.lastSpoken = Infinity;
}

function consume(i: Side, dt: number): void {
  const p = players[i];
  if (p.flagged) return;
  p.turnMs += dt;
  if (cfg.mode === "hourglass") {
    const d = Math.min(p.main, dt);
    p.main -= d;
    players[i === 0 ? 1 : 0].main += d; // sand flows to the opponent
    if (p.main <= 0) flag(i);
    return;
  }
  if (p.delay > 0) {
    const d = Math.min(p.delay, dt);
    p.delay -= d; dt -= d;
  }
  if (dt <= 0) return;
  if (!p.overtime) {
    const d = Math.min(p.main, dt);
    p.main -= d; p.usedThisTurn += d; dt -= d;
    if (p.main <= 0) {
      if (!isByoyomi()) return flag(i);
      enterOvertime(p);
      announceText(cfg.mode === "japanese" ? `Byo-yomi, ${cfg.periods}` : "Overtime");
    }
  }
  if (!p.overtime || dt <= 0) return;
  p.period -= dt;
  if (cfg.mode === "japanese") {
    while (p.period <= 0 && p.periodsLeft > 1) {
      p.periodsLeft--;
      p.period += cfg.periodSec * 1000;
      p.lastSpoken = Infinity;
      announceText(p.periodsLeft === 1 ? "Last period" : String(p.periodsLeft));
      buzz("period");
    }
  }
  if (p.period <= 0) { p.period = 0; flag(i); }
}

function endTurn(i: Side): void {
  const p = players[i];
  p.moves++;
  p.lastMoveMs = p.turnMs;
  const stage = cfg.stages[p.stageIdx];
  if (stage && cfg.mode !== "hourglass" && p.moves >= stage.afterMoves) {
    p.stageIdx++;
    if (!p.overtime) {
      p.main += stage.addSec * 1000;
      p.lastSpoken = Infinity;
      buzz("period");
    }
  }
  switch (cfg.mode) {
    case "fischer": p.main += cfg.extraSec * 1000; break;
    case "bronstein": p.main += Math.min(cfg.extraSec * 1000, p.usedThisTurn); break;
    case "japanese": if (p.overtime) p.period = cfg.periodSec * 1000; break;
    case "canadian":
      if (p.overtime) {
        p.stonesLeft--;
        if (p.stonesLeft <= 0) { p.stonesLeft = cfg.stones; p.period = cfg.periodSec * 1000; p.warned = false; }
      }
      break;
  }
  p.delay = 0;
}

function flag(i: Side): void {
  players[i].flagged = true;
  running = false;
  stopLoop();
  releaseWake();
  announceText("Time", true);
  buzz("flag");
  tone(440, 0.9);
  render();
}

/** Remaining ms in the phase that matters for the countdown. */
function phaseLeft(p: Player): number {
  return p.overtime ? p.period : p.main + p.delay;
}

// ---------- loop (10 Hz while running; idle otherwise to save battery) ----------
// Wall-clock time, not performance.now(): iOS freezes the latter while the app is suspended, but a
// game clock must keep running for the player on move.
let timer = 0;
function startLoop(): void {
  stopLoop();
  lastTs = Date.now();
  timer = window.setInterval(tick, 100);
}
function stopLoop(): void { if (timer) { clearInterval(timer); timer = 0; } }

function tick(): void {
  if (!running || active === -1) return;
  const now = Date.now();
  const dt = now - lastTs;
  lastTs = now;
  const a = active;
  consume(a, dt);
  if (running) checkCountdown(a);
  render();
}

function checkCountdown(i: Side): void {
  const p = players[i];
  if (cfg.mode === "canadian" && p.overtime && !p.warned && p.period < p.stonesLeft * prefs.threshold * 1000) {
    p.warned = true;
    tone(660, 0.25); buzz("warn");
  }
  if (p.delay > 0) return; // free delay time is not counted down
  const left = Math.ceil(phaseLeft(p) / 1000);
  if (left <= prefs.threshold && left > 0 && left < p.lastSpoken) {
    p.lastSpoken = left;
    if (prefs.alert === "voice") announceText(String(left));
    else if (prefs.alert === "beep") tone(left <= 3 ? 1046 : 880, 0.09);
    buzz("tick");
  }
}

// ---------- undo ----------
interface Snapshot { players: [Player, Player]; active: Side | -1 }
const undoStack: Snapshot[] = [];
function pushUndo(): void {
  undoStack.push({ players: [{ ...players[0] }, { ...players[1] }], active });
  if (undoStack.length > 50) undoStack.shift();
}
/** Give the turn back to the player who just pressed, with clocks as they were at that press. Leaves the clock paused. */
function undo(): void {
  const s = undoStack.pop();
  if (!s) return;
  stopLoop(); releaseWake();
  players[0] = s.players[0]; players[1] = s.players[1];
  active = s.active;
  running = false;
  render();
}

// ---------- controls ----------
function press(i: Side): void {
  unlockAudio();
  if (players[0].flagged || players[1].flagged) return;
  if (active === -1) { // first press starts the opponent's clock
    switchTo(i === 0 ? 1 : 0);
    return;
  }
  if (!running || active !== i) return;
  pushUndo();
  endTurn(i);
  if (prefs.tapHaptic) buzz("tap", true);
  switchTo(i === 0 ? 1 : 0);
}

function switchTo(next: Side): void {
  active = next;
  startTurn(next);
  running = true;
  startLoop();
  requestWake();
  render();
}

function togglePause(): void {
  unlockAudio();
  if (players[0].flagged || players[1].flagged) return;
  if (active === -1) { switchTo(1); return; } // bottom (e.g. White / Black-in-Go) starts
  running = !running;
  if (running) { startLoop(); requestWake(); } else { stopLoop(); releaseWake(); try { speechSynthesis.cancel(); } catch { /* none */ } }
  render();
}

function resetGame(): void {
  stopLoop();
  releaseWake();
  running = false;
  active = -1;
  players[0] = newPlayer(0);
  players[1] = newPlayer(1);
  undoStack.length = 0;
  render();
}

// ---------- rendering ----------
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const halves = [$("p0"), $("p1")] as const;
const part = (h: HTMLElement, k: string) => h.querySelector(`[data-k="${k}"]`) as HTMLElement;

function fmt(ms: number): string {
  if (ms <= 0) return "0:00";
  if (ms < 10_000) return (Math.ceil(ms / 100) / 10).toFixed(1);
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
const fmtShort = (ms: number): string => ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : fmt(ms);
const short = (sec: number): string => sec >= 60 ? (sec % 60 ? `${Math.floor(sec / 60)}m${sec % 60}s` : `${sec / 60}m`) : `${sec}s`;

function modeLabel(): string {
  switch (cfg.mode) {
    case "japanese": return `Byo-yomi ${cfg.periods}×${short(cfg.periodSec)}`;
    case "canadian": return `Canadian ${cfg.stones}/${short(cfg.periodSec)}`;
    case "fischer": return `Fischer +${cfg.extraSec}s`;
    case "bronstein": return `Bronstein ${cfg.extraSec}s`;
    case "delay": return `Delay ${cfg.extraSec}s`;
    case "hourglass": return "Hourglass";
    case "absolute": return cfg.stages.length ? `${cfg.stages.length + 1} stages` : "Sudden death";
    default: return "Sudden death";
  }
}

function stonesDots(n: number, total: number): string {
  const max = Math.min(total, 10);
  let s = '<span class="stones" aria-hidden="true">';
  for (let k = 0; k < max; k++) s += `<span class="stone${k < n ? " on" : ""}"></span>`;
  return s + "</span>";
}

function nextStage(p: Player): Stage | undefined {
  return cfg.mode === "hourglass" || p.overtime ? undefined : cfg.stages[p.stageIdx];
}

function infoFor(i: Side): string {
  const p = players[i];
  if (p.flagged) return "Out of time";
  const next = nextStage(p);
  if (next) {
    const left = next.afterMoves - p.moves;
    return `<span>${left} move${left === 1 ? "" : "s"} to +${short(next.addSec)}</span>`;
  }
  if (cfg.mode === "japanese") {
    if (!p.overtime) return `Main time · then ${cfg.periods}×${short(cfg.periodSec)}`;
    const dots = cfg.periods <= 10 ? stonesDots(p.periodsLeft, cfg.periods) : "";
    return `${dots}<span>${p.periodsLeft === 1 ? "Last period" : `${p.periodsLeft} periods left`}</span>`;
  }
  if (cfg.mode === "canadian") {
    if (!p.overtime) return `Main time · then ${cfg.stones} stones / ${short(cfg.periodSec)}`;
    return `<span class="stone on" aria-hidden="true"></span><span>${p.stonesLeft} of ${cfg.stones} stones to play</span>`;
  }
  if (cfg.mode === "delay") return active === i && running && p.delay > 0 ? `Delay ${(p.delay / 1000).toFixed(1)}s` : `${cfg.extraSec}s delay each move`;
  if (cfg.mode === "fischer") return `+${cfg.extraSec}s after each move`;
  if (cfg.mode === "bronstein") return `Up to ${cfg.extraSec}s back each move`;
  if (cfg.mode === "hourglass") return "Your thinking time goes to your opponent";
  return "No added time";
}

let lastHtml = ["", ""];
function render(): void {
  const someoneFlagged = players[0].flagged || players[1].flagged;
  for (const i of [0, 1] as Side[]) {
    const p = players[i], h = halves[i];
    const left = p.overtime ? p.period : p.main;
    h.classList.toggle("live", active === i && !p.flagged);
    h.classList.toggle("flag", p.flagged);
    h.classList.toggle("low", !p.flagged && phaseLeft(p) <= prefs.threshold * 1000 && phaseLeft(p) > 0 && p.delay <= 0);
    const shown = p.flagged ? "0:00" : fmt(left);
    const timeEl = part(h, "time");
    timeEl.textContent = shown;
    timeEl.classList.toggle("long", shown.length > 5); // h:mm:ss needs smaller digits to fit
    part(h, "pill").textContent = p.overtime ? (cfg.mode === "japanese" ? "Byo-yomi" : "Overtime") : modeLabel();
    const next = nextStage(p);
    const mv = next ? `Move ${p.moves}/${next.afterMoves}` : `Move ${p.moves}`;
    part(h, "moves").textContent = p.lastMoveMs >= 0 ? `${mv} · last ${fmtShort(p.lastMoveMs)}` : mv;
    const html = infoFor(i);
    if (html !== lastHtml[i]) { part(h, "info").innerHTML = html; lastHtml[i] = html; }
  }
  const play = $("btnPlay");
  (play.querySelector('[data-icon="play"]') as SVGElement).toggleAttribute("hidden", running);
  (play.querySelector('[data-icon="pause"]') as SVGElement).toggleAttribute("hidden", !running);
  play.setAttribute("aria-label", running ? "Pause" : "Start");
  $<HTMLButtonElement>("btnUndo").disabled = undoStack.length === 0;
  $("hint").textContent = someoneFlagged ? "Flag fell · reset for a new game"
    : active === -1 ? "Tap your side to start your opponent's clock"
    : running ? "Tap your side after you move" : "Paused";
}

// ---------- sound, speech, haptics, wake lock ----------
let audio: AudioContext | null = null;
function unlockAudio(): void {
  if (!audio) {
    try { audio = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { audio = null; }
  }
  audio?.resume().catch(() => undefined);
  // iOS only lets speech start from a user gesture: speak a silent utterance on the first tap.
  if (!speechUnlocked && prefs.alert === "voice") {
    speechUnlocked = true;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } catch { /* none */ }
  }
}
let speechUnlocked = false;
function tone(freq: number, dur: number): void {
  if (!audio || prefs.alert === "off") return;
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
  o.frequency.value = freq; o.type = "sine";
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function announceText(text: string, force = false): void {
  if (prefs.alert !== "voice" && !force) return;
  if (prefs.alert === "off") return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (prefs.lang) {
      u.lang = prefs.lang;
      const v = speechSynthesis.getVoices().find(x => x.lang === prefs.lang);
      if (v) u.voice = v;
    }
    u.rate = 1.15;
    speechSynthesis.speak(u);
  } catch { /* speech unavailable */ }
}
const PATTERNS: Record<Haptic, number[]> = { tap: [18], tick: [60], warn: [200], period: [120, 60, 120], flag: [400, 120, 400, 120, 400] };
/** Haptics: Taptic Engine in the iOS app, Vibration API on Android browsers, nothing on iOS Safari (no API). */
function buzz(kind: Haptic, isTap = false): void {
  if (!isTap && !prefs.vibrate) return;
  try {
    if (window.taikyokuNative) window.taikyokuNative.haptic(kind);
    else navigator.vibrate?.(PATTERNS[kind]);
  } catch { /* unsupported */ }
}
let wake: { release(): Promise<void> } | null = null;
function requestWake(): void {
  if (window.taikyokuNative) { window.taikyokuNative.keepAwake(true); return; }
  const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
  if (wake || !nav.wakeLock) return;
  nav.wakeLock.request("screen").then(w => { wake = w; }).catch(() => undefined);
}
function releaseWake(): void {
  window.taikyokuNative?.keepAwake(false);
  wake?.release().catch(() => undefined); wake = null;
}

/**
 * Picks how the two halves sit. Tall screens stack the players (top half turned to face the
 * opponent); wide screens — landscape iPhone, iPad, an unfolded foldable — put them side by side.
 * "facing" turns each half toward its player; "upright" keeps both readable from one side,
 * like a clock standing beside the board.
 */
function applyLayout(): void {
  const wide = window.innerWidth > window.innerHeight * 1.1;
  const facing = prefs.layout === "facing" || (prefs.layout === "auto" && !wide);
  document.body.dataset.layout = `${facing ? "facing" : "upright"}-${wide ? "cols" : "rows"}`;
}

function applyTheme(): void {
  if (prefs.theme === "auto") delete document.body.dataset.skin;
  else document.body.dataset.skin = prefs.theme;
}

// ---------- settings sheet ----------
const num = (id: string): number => { const v = Number($<HTMLInputElement>(id).value); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; };
const setNum = (id: string, v: number) => { $<HTMLInputElement>(id).value = String(v); };
let draftThreshold = prefs.threshold;

function fillForm(c: Config): void {
  $<HTMLSelectElement>("fMode").value = c.mode;
  setNum("fMainMin", Math.floor(c.mainSec / 60)); setNum("fMainSec", c.mainSec % 60);
  setNum("fExtra", c.extraSec); setNum("fPeriods", c.periods); setNum("fStones", c.stones);
  setNum("fPerMin", Math.floor(c.periodSec / 60)); setNum("fPerSec", c.periodSec % 60);
  $<HTMLInputElement>("fHcOn").checked = c.hcOn;
  $<HTMLSelectElement>("fHcPlayer").value = String(c.hcPlayer);
  setNum("fHcMin", Math.round(c.hcSec / 60));
  draftStages = (c.stages ?? []).map(s => ({ ...s }));
  renderStages();
  syncForm();
}

function readForm(): Config {
  const mode = $<HTMLSelectElement>("fMode").value as Mode;
  return {
    mode,
    mainSec: num("fMainMin") * 60 + Math.min(59, num("fMainSec")),
    extraSec: num("fExtra"),
    periods: Math.max(1, num("fPeriods")),
    stones: Math.max(1, num("fStones")),
    periodSec: Math.max(1, num("fPerMin") * 60 + Math.min(59, num("fPerSec"))),
    hcOn: $<HTMLInputElement>("fHcOn").checked,
    hcPlayer: ($<HTMLSelectElement>("fHcPlayer").value === "0" ? 0 : 1) as Side,
    hcSec: num("fHcMin") * 60,
    stages: mode === "hourglass" ? [] : cleanStages(draftStages),
  };
}

// ----- stage editor -----
let draftStages: Stage[] = [];
function cleanStages(list: Stage[]): Stage[] {
  const seen = new Set<number>();
  return list
    .filter(s => s.afterMoves > 0 && s.addSec > 0)
    .sort((a, b) => a.afterMoves - b.afterMoves)
    .filter(s => (seen.has(s.afterMoves) ? false : (seen.add(s.afterMoves), true)));
}
function renderStages(): void {
  const box = $("stageRows");
  box.innerHTML = "";
  draftStages.forEach((s, k) => {
    const row = document.createElement("div");
    row.className = "row stage-row";
    row.innerHTML = `<span class="lbl">Stage ${k + 2}</span>
      <span class="dur">at move <input type="number" min="1" max="500" id="stMoves${k}" aria-label="Stage ${k + 2} starts after move">
      + <input type="number" min="0" max="600" id="stMin${k}" aria-label="Stage ${k + 2} minutes added"> min
      <button type="button" class="del" aria-label="Remove stage ${k + 2}">×</button></span>`;
    const mv = row.querySelector<HTMLInputElement>(`#stMoves${k}`)!, mn = row.querySelector<HTMLInputElement>(`#stMin${k}`)!;
    mv.value = String(s.afterMoves); mn.value = String(Math.round(s.addSec / 60));
    mv.addEventListener("input", () => { s.afterMoves = Math.max(0, Math.floor(Number(mv.value) || 0)); syncStageNote(); });
    mn.addEventListener("input", () => { s.addSec = Math.max(0, Math.floor(Number(mn.value) || 0)) * 60; syncStageNote(); });
    row.querySelector(".del")!.addEventListener("click", () => { draftStages.splice(k, 1); renderStages(); });
    box.append(row);
  });
  $("stageFirst").hidden = draftStages.length === 0;
  syncStageNote();
}
function syncStageNote(): void {
  const first = draftStages.length ? Math.min(...draftStages.map(s => s.afterMoves || Infinity)) : 0;
  $("stageFirstText").textContent = first && Number.isFinite(first) ? `Main time covers moves 1–${first}` : "";
}
function addStage(): void {
  const last = draftStages[draftStages.length - 1];
  draftStages.push(last ? { afterMoves: last.afterMoves + 20, addSec: 900 } : { afterMoves: 40, addSec: 1800 });
  renderStages();
}

const NOTES: Record<Mode, string> = {
  japanese: "After main time, each move must be made within one period. Moving in time keeps the period; running past it uses one up. Losing the last period loses the game.",
  canadian: "After main time, play the set number of stones within the period. When all are played, a fresh period starts.",
  fischer: "The increment is added to your clock after every move, so time can build up.",
  bronstein: "After each move you get back the time you used, up to the delay. Your clock never grows past where the move began.",
  delay: "Your clock waits for the delay before it starts counting down on each move. Unused delay is lost.",
  absolute: "One fixed amount of time for the whole game.",
  hourglass: "Time you spend thinking drains from your clock into your opponent's, like a sand timer. Run out and you lose.",
};

function syncForm(): void {
  const mode = $<HTMLSelectElement>("fMode").value as Mode;
  document.querySelectorAll<HTMLElement>("[data-for]").forEach(r => { r.hidden = !(r.dataset.for ?? "").split(" ").includes(mode); });
  $("lExtra").textContent = mode === "fischer" ? "Increment" : "Delay";
  $("modeNote").textContent = NOTES[mode];
  document.querySelectorAll<HTMLElement>("[data-stage]").forEach(r => { r.hidden = mode === "hourglass"; });
  const hc = $<HTMLInputElement>("fHcOn").checked;
  document.querySelectorAll<HTMLElement>("[data-hc]").forEach(r => { r.hidden = !hc; });
  $("thOut").textContent = String(draftThreshold);
  $("thNote").textContent = mode === "canadian"
    ? `Last ${draftThreshold}s, plus a warning when time drops below stones left × ${draftThreshold}s`
    : `Alerts during the last ${draftThreshold} seconds`;
}

function fillPrefs(): void {
  draftThreshold = prefs.threshold;
  $<HTMLSelectElement>("fAlert").value = prefs.alert;
  $<HTMLInputElement>("fVib").checked = prefs.vibrate;
  $<HTMLInputElement>("fTap").checked = prefs.tapHaptic;
  $<HTMLSelectElement>("fTheme").value = prefs.theme;
  $<HTMLSelectElement>("fLayout").value = prefs.layout;
  fillLangs();
}

function fillLangs(): void {
  const sel = $<HTMLSelectElement>("fLang");
  let langs: string[] = [];
  try { langs = [...new Set(speechSynthesis.getVoices().map(v => v.lang))].sort(); } catch { /* none */ }
  if (prefs.lang && !langs.includes(prefs.lang)) langs.unshift(prefs.lang);
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([navigator.language || "en"], { type: "language" }); } catch { /* old browser */ }
  sel.innerHTML = "";
  sel.add(new Option("Device default", ""));
  for (const l of langs) {
    let label = l;
    try { label = `${names?.of(l) ?? l} (${l})`; } catch { /* keep code */ }
    sel.add(new Option(label, l));
  }
  sel.value = prefs.lang;
}

function renderPresets(): void {
  const list = $("presetList");
  list.innerHTML = "";
  const all = [...BUILTIN, ...custom];
  all.forEach((p, idx) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.name;
    b.addEventListener("click", () => fillForm(p.cfg));
    chip.append(b);
    if (!p.builtin) {
      const x = document.createElement("button");
      x.type = "button"; x.className = "x"; x.textContent = "×";
      x.setAttribute("aria-label", `Delete preset ${p.name}`);
      x.addEventListener("click", () => {
        custom = custom.filter((_, k) => k !== idx - BUILTIN.length);
        store.set("tk.presets", custom);
        renderPresets();
      });
      chip.append(x);
    }
    list.append(chip);
  });
}

let wasRunning = false;
function openSettings(): void {
  wasRunning = running;
  if (running) togglePause();
  fillForm(cfg); fillPrefs(); renderPresets(); syncForm();
  $("sheet").hidden = false;
}
function closeSettings(): void {
  $("sheet").hidden = true;
  applyTheme();
  applyLayout();
  render();
}

// ---------- wiring ----------
halves.forEach((h, i) => h.addEventListener("pointerdown", e => { e.preventDefault(); press(i as Side); }));
halves.forEach((h, i) => h.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); press(i as Side); } }));

$("btnPlay").addEventListener("click", togglePause);
$("btnUndo").addEventListener("click", undo);
$("btnAddStage").addEventListener("click", addStage);
document.querySelectorAll<HTMLButtonElement>("[data-proxy]").forEach(b => b.addEventListener("click", () => $(b.dataset.proxy!).click()));
const resetBtn = $("btnReset");
const resetIcon = resetBtn.innerHTML;
let resetArmed = 0;
resetBtn.addEventListener("click", () => {
  const fresh = active === -1 && players.every(p => p.moves === 0);
  if (fresh || resetArmed) {
    clearTimeout(resetArmed); resetArmed = 0;
    resetBtn.classList.remove("armed"); resetBtn.innerHTML = resetIcon;
    resetGame();
    return;
  }
  if (running) togglePause();
  resetBtn.classList.add("armed"); resetBtn.textContent = "Tap to reset";
  resetArmed = window.setTimeout(() => { resetArmed = 0; resetBtn.classList.remove("armed"); resetBtn.innerHTML = resetIcon; }, 3000);
});
$("btnSettings").addEventListener("click", openSettings);
$("btnClose").addEventListener("click", () => { closeSettings(); if (wasRunning) togglePause(); });
$("sheet").addEventListener("click", e => { if (e.target === $("sheet")) $("btnClose").click(); });

["fMode", "fHcOn"].forEach(id => $(id).addEventListener("change", syncForm));
$("thDown").addEventListener("click", () => { draftThreshold = Math.max(0, draftThreshold - 1); syncForm(); });
$("thUp").addEventListener("click", () => { draftThreshold = Math.min(60, draftThreshold + 1); syncForm(); });
$("fTheme").addEventListener("change", () => {
  const t = $<HTMLSelectElement>("fTheme").value as Theme;
  if (t === "auto") delete document.body.dataset.skin; else document.body.dataset.skin = t;
});
try { speechSynthesis.addEventListener("voiceschanged", () => { if (!$("sheet").hidden) fillLangs(); }); } catch { /* none */ }

$("btnSave").addEventListener("click", () => {
  const input = $<HTMLInputElement>("fPresetName");
  const name = input.value.trim() || modeLabel();
  custom.push({ name, cfg: readForm() });
  store.set("tk.presets", custom);
  input.value = "";
  renderPresets();
});

$<HTMLFormElement>("form").addEventListener("submit", e => {
  e.preventDefault();
  prefs = {
    threshold: draftThreshold,
    alert: $<HTMLSelectElement>("fAlert").value as AlertMethod,
    lang: $<HTMLSelectElement>("fLang").value,
    vibrate: $<HTMLInputElement>("fVib").checked,
    tapHaptic: $<HTMLInputElement>("fTap").checked,
    theme: $<HTMLSelectElement>("fTheme").value as Theme,
    layout: $<HTMLSelectElement>("fLayout").value as Layout,
  };
  store.set("tk.prefs", prefs);
  const next = readForm();
  const changed = JSON.stringify(next) !== JSON.stringify(cfg);
  cfg = next;
  store.set("tk.cfg", cfg);
  closeSettings();
  if (changed) resetGame(); else if (wasRunning) togglePause();
});

document.addEventListener("keydown", e => {
  if (!$("sheet").hidden) { if (e.key === "Escape") $("btnClose").click(); return; }
  if (e.key === " ") {
    e.preventDefault();
    if (active === -1) togglePause(); else press(active);
  } else if (e.key === "p" || e.key === "P") togglePause();
  else if (e.key === "u" || e.key === "U") undo();
});
document.addEventListener("visibilitychange", () => {
  // The app may have been suspended; catch the running clock up immediately on return.
  if (document.visibilityState === "visible" && running) { tick(); requestWake(); }
});

window.addEventListener("resize", applyLayout);
$("fLayout").addEventListener("change", () => {
  const prev = prefs.layout;
  prefs.layout = $<HTMLSelectElement>("fLayout").value as Layout;
  applyLayout();
  prefs.layout = prev; // committed on Apply
});

applyTheme();
applyLayout();
render();
