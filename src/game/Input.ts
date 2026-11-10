// Keyboard / mouse input with rebindable actions and pointer lock (drag-to-look fallback).
import type { Action } from "../state/settings";

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  dx = 0; dy = 0; wheel = 0;
  clickL = false; clickR = false;
  locked = false;
  enabled = true;
  private dragging = false; private dragDist = 0;
  private off: (() => void)[] = [];
  onLockChange: (locked: boolean) => void = () => {};
  onEscape: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement, private keys: () => Record<Action, string>) {
    const on = <K extends keyof DocumentEventMap>(t: EventTarget, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(ev, fn as EventListener, opts));
    };
    on(window, "keydown", (e: KeyboardEvent) => {
      if (e.code === "Escape") { this.onEscape(); return; }
      if (!this.enabled) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Tab" || e.code === "Space" || e.code === "Quote" || e.code === "Slash") e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    on(window, "keyup", (e: KeyboardEvent) => { this.down.delete(e.code); });
    on(window, "blur", () => { this.down.clear(); });
    on(canvas, "mousedown", (e: MouseEvent) => {
      if (!this.enabled) return;
      if (e.button === 0) { if (this.locked) this.clickL = true; else { this.dragging = true; this.dragDist = 0; } }
      if (e.button === 2) this.clickR = true;
    });
    on(window, "mouseup", (e: MouseEvent) => {
      if (e.button === 0 && this.dragging) { this.dragging = false; if (this.dragDist < 5 && this.enabled) this.clickL = true; }
    });
    on(window, "mousemove", (e: MouseEvent) => {
      if (!this.enabled) return;
      if (this.locked || this.dragging) { this.dx += e.movementX; this.dy += e.movementY; this.dragDist += Math.abs(e.movementX) + Math.abs(e.movementY); }
    });
    on(canvas, "wheel", (e: WheelEvent) => { if (this.enabled) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    on(canvas, "contextmenu", (e: Event) => e.preventDefault());
    on(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      this.onLockChange(this.locked);
    });
  }

  lock() {
    try { const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); } catch { /* unavailable: drag-to-look still works */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  is(a: Action) { return this.enabled && this.down.has(this.keys()[a]); }
  hit(a: Action) { return this.enabled && this.pressed.has(this.keys()[a]); }
  hitCode(code: string) { return this.enabled && this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.dx = 0; this.dy = 0; this.wheel = 0; this.clickL = false; this.clickR = false; }
  reset() { this.down.clear(); this.endFrame(); }
  dispose() { this.off.forEach((f) => f()); }
}
