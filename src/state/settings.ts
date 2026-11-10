// Persistent player settings (localStorage). No engine or UI imports here.

export type QualityPreset = "low" | "medium" | "high" | "ultra" | "custom";
export type TimeOfDay = "morning" | "afternoon" | "golden" | "night";
export type Weather = "sunny" | "cloudy" | "rainy";
export type PhotoRes = "720" | "1080" | "1440";

export type Action =
  | "forward" | "back" | "left" | "right" | "run" | "interact" | "toggleView"
  | "camera" | "focus" | "gallery" | "review" | "afMode" | "shootMode"
  | "apertureDown" | "apertureUp" | "shutterDown" | "shutterUp" | "isoDown" | "isoUp"
  | "compDown" | "compUp" | "focusNear" | "focusFar" | "grid";

export const ACTION_LABELS: Record<Action, string> = {
  forward: "Move forward", back: "Move back", left: "Move left", right: "Move right",
  run: "Run", interact: "Interact with NPC", toggleView: "First / third person",
  camera: "Raise / lower camera", focus: "Autofocus", gallery: "Open gallery",
  review: "Review last shots", afMode: "AF-C / MF", shootMode: "Portrait / Landscape / Manual",
  apertureDown: "Aperture wider", apertureUp: "Aperture narrower",
  shutterDown: "Shutter slower", shutterUp: "Shutter faster",
  isoDown: "ISO down", isoUp: "ISO up", compDown: "Exposure comp −", compUp: "Exposure comp +",
  focusNear: "Manual focus nearer", focusFar: "Manual focus farther", grid: "Toggle thirds grid",
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", run: "ShiftLeft",
  interact: "KeyE", toggleView: "KeyV", camera: "KeyC", focus: "KeyF", gallery: "KeyG",
  review: "Tab", afMode: "KeyX", shootMode: "KeyQ",
  apertureDown: "BracketLeft", apertureUp: "BracketRight",
  shutterDown: "Comma", shutterUp: "Period", isoDown: "Semicolon", isoUp: "Quote",
  compDown: "Minus", compUp: "Equal", focusNear: "KeyR", focusFar: "KeyT", grid: "KeyH",
};

export interface Settings {
  preset: QualityPreset;
  renderer: "auto" | "webgl";
  resolutionScale: number; // 0.5 .. 1
  shadows: 0 | 1 | 2 | 3; // off, low, medium, high
  crowdDensity: number; // 0.5 .. 1.6
  antialias: "off" | "fxaa" | "msaa";
  effects: 0 | 1 | 2; // minimal, standard, full (bloom, AO, grain)
  fpsLimit: 0 | 30 | 60;
  adaptiveResolution: boolean;
  time: TimeOfDay;
  weather: Weather;
  photoRes: PhotoRes;
  volMaster: number; volAmbient: number; volTraffic: number; volSfx: number; volVoices: number;
  sensitivity: number;
  invertY: boolean;
  headBob: boolean;
  showHints: boolean;
  keys: Record<Action, string>;
}

export const PRESETS: Record<Exclude<QualityPreset, "custom">, Partial<Settings>> = {
  low: { resolutionScale: 0.6, shadows: 0, crowdDensity: 0.6, antialias: "off", effects: 0 },
  medium: { resolutionScale: 0.8, shadows: 1, crowdDensity: 0.85, antialias: "fxaa", effects: 1 },
  high: { resolutionScale: 1, shadows: 2, crowdDensity: 1, antialias: "fxaa", effects: 2 },
  ultra: { resolutionScale: 1, shadows: 3, crowdDensity: 1.4, antialias: "msaa", effects: 2 },
};

function detectPreset(): Exclude<QualityPreset, "custom"> {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4;
  let gpu = "";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch { /* ignore */ }
  const software = /swiftshader|llvmpipe|software|basic render/.test(gpu);
  const discrete = /rtx|gtx|radeon rx|arc |apple m\d|geforce/.test(gpu);
  if (software) return "low";
  if (discrete && cores >= 8) return "high";
  if (cores >= 6 && mem >= 8) return "medium";
  return cores >= 4 ? "medium" : "low";
}

const KEY = "ssp.settings.v1";
const NAME_KEY = "ssp.playerName";

export function defaultSettings(): Settings {
  const preset = detectPreset();
  return {
    preset, renderer: "auto",
    resolutionScale: 1, shadows: 2, crowdDensity: 1, antialias: "fxaa", effects: 2,
    ...PRESETS[preset],
    fpsLimit: 60, adaptiveResolution: true,
    time: "afternoon", weather: "sunny", photoRes: "1080",
    volMaster: 0.8, volAmbient: 0.7, volTraffic: 0.7, volSfx: 0.9, volVoices: 0.8,
    sensitivity: 1, invertY: false, headBob: true, showHints: true,
    keys: { ...DEFAULT_KEYS },
  } as Settings;
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return { ...d, ...s, keys: { ...d.keys, ...(s.keys || {}) } };
    }
  } catch { /* corrupted settings fall back to defaults */ }
  return d;
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota */ }
}

export function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}
export function saveName(n: string) {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
}

export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  const map: Record<string, string> = {
    ShiftLeft: "Shift", ShiftRight: "R-Shift", BracketLeft: "[", BracketRight: "]",
    Comma: ",", Period: ".", Semicolon: ";", Quote: "'", Minus: "-", Equal: "=",
    Space: "Space", ControlLeft: "Ctrl", AltLeft: "Alt",
  };
  return map[code] || code;
}

/** Next file counter for the day: shibuya-photo-YYYY-MM-DD-NNN */
export function nextPhotoFileBase(): string {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let n = 1;
  try {
    const raw = JSON.parse(localStorage.getItem("ssp.photoCounter") || "{}") as { day?: string; n?: number };
    if (raw.day === day && raw.n) n = raw.n + 1;
    localStorage.setItem("ssp.photoCounter", JSON.stringify({ day, n }));
  } catch { /* ignore */ }
  return `shibuya-photo-${day}-${String(n).padStart(3, "0")}`;
}
