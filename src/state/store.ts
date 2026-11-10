// Tiny UI store: the game pushes plain state, React reads it. Neither side imports the other.
import { useSyncExternalStore } from "react";
import type { Settings } from "./settings";
import { loadSettings, loadName } from "./settings";

export interface ScoreBreakdown {
  total: number;
  parts: { key: string; label: string; score: number; max: number; note: string }[];
  notes: string[];
}

export interface ShotMeta {
  id: string;
  fileBase: string;
  takenAt: number;
  width: number; height: number;
  npcName: string | null;
  portraitType: "walking" | "static" | null;
  score: ScoreBreakdown | null;
  focal: number; aperture: number; shutter: number; iso: number; comp: number;
  mode: string; time: string; weather: string;
}

export interface RollShot { meta: ShotMeta; url: string; thumbUrl: string; saved: boolean }

export interface CameraHud {
  focal: number; aperture: number; shutter: number; iso: number; comp: number;
  meter: number; mode: string; af: string; focusDist: number; focusLocked: boolean;
  battery: number; shots: number; grid: boolean; subject: string | null; subjectInFrame: boolean;
  blurRisk: boolean;
}

export interface DialogueState {
  npcName: string; tag: string;
  lines: { who: string; text: string }[];
  choices: { label: string }[];
}

export interface UIState {
  screen: "menu" | "loading" | "game";
  overlay: null | "pause" | "settings" | "gallery" | "review";
  loading: { progress: number; label: string };
  error: string | null;
  playerName: string;
  settings: Settings;
  renderer: string;
  fps: number;
  viewMode: "tps" | "fps";
  pointerLocked: boolean;
  prompt: string | null;
  signal: { ped: "green" | "flash" | "red"; label: string; timeLeft: number; veh: string };
  warning: string | null;
  subtitle: { who: string; text: string } | null;
  dialogue: DialogueState | null;
  camera: CameraHud | null;
  lastShot: { url: string; score: number | null; label: string; t: number } | null;
  roll: RollShot[];
  session: { npcName: string; type: string; hint: string } | null;
  toast: { text: string; t: number } | null;
}

let state: UIState = {
  screen: "menu", overlay: null,
  loading: { progress: 0, label: "" }, error: null,
  playerName: loadName(), settings: loadSettings(), renderer: "",
  fps: 0, viewMode: "tps", pointerLocked: false,
  prompt: null,
  signal: { ped: "red", label: "", timeLeft: 0, veh: "" },
  warning: null, subtitle: null, dialogue: null, camera: null, lastShot: null,
  roll: [], session: null, toast: null,
};

const listeners = new Set<() => void>();

export const ui = {
  get: () => state,
  set(patch: Partial<UIState>) {
    let changed = false;
    for (const k in patch) {
      if ((state as unknown as Record<string, unknown>)[k] !== (patch as Record<string, unknown>)[k]) { changed = true; break; }
    }
    if (!changed) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  toast(text: string) { ui.set({ toast: { text, t: Date.now() } }); },
};

export function useUI<T>(sel: (s: UIState) => T): T {
  return useSyncExternalStore(ui.subscribe, () => sel(state));
}

/** Commands the UI can send to the running game. Filled in by GameEngine. */
export interface GameCommands {
  resume(): void;
  pause(): void;
  openOverlay(o: UIState["overlay"]): void;
  applySettings(s: Settings): void;
  chooseDialogue(i: number): void;
  quitToMenu(): void;
  discardShot(id: string): void;
  markSaved(id: string): void;
  getShotBlob(id: string): Blob | null;
  requestPointerLock(): void;
  retake(id: string): void;
  shutter(): void;
  toggleCamera(): void;
}
export const game: { cmd: GameCommands | null } = { cmd: null };
