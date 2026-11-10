// PhotographySystem: simulated lens (zoom, focus, aperture, shutter, ISO), real frame capture and scoring.
import { AbstractEngine, DefaultRenderingPipeline, DepthOfFieldEffectBlurLevel, CreateScreenshotUsingRenderTargetAsync } from "@babylonjs/core";
import type { PlayerController } from "./PlayerController";
import type { Input } from "./Input";
import type { NPC } from "./NPCBehaviorSystem";
import type { CameraHud, RollShot, ScoreBreakdown, ShotMeta } from "../state/store";
import { nextPhotoFileBase, PhotoRes } from "../state/settings";
import { clamp, damp, groundY, rayBoxes, angDiff } from "./world/layout";

export const APERTURES = [1.8, 2.8, 4, 5.6, 8, 11, 16];
export const SHUTTERS = [1 / 15, 1 / 30, 1 / 60, 1 / 125, 1 / 250, 1 / 500, 1 / 1000, 1 / 2000, 1 / 4000];
export const ISOS = [100, 200, 400, 800, 1600, 3200, 6400];
export type ShootMode = "PORTRAIT" | "LANDSCAPE" | "MANUAL";
const RES: Record<PhotoRes, [number, number]> = { "720": [1280, 720], "1080": [1920, 1080], "1440": [2560, 1440] };
const ASPECT = 16 / 9;

export interface SceneLight { ev: number; baseExposure: number }
export interface PhotoWorld {
  npcs: NPC[]; subject: NPC | null;
  vehicleBoxes: { x0: number; x1: number; z0: number; z1: number }[];
  light: SceneLight; unsafe: boolean; time: string; weather: string;
}
interface Stored { meta: ShotMeta; blob: Blob; thumb: Blob; url: string; thumbUrl: string; saved: boolean }

export class PhotographySystem {
  focal = 50; ap = 1; sh = 4; iso = 0; comp = 0;
  mode: ShootMode = "PORTRAIT"; af: "AF-C" | "MF" = "AF-C";
  focusDist = 5; focusLocked = false; grid = true;
  battery = 1; shots = 0;
  // derived each frame
  shutter = 1 / 250; isoVal = 100; meter = 0; lensFov = 0.47; blurRisk = false;
  private t = 0; private cooldown = 0; private dofOn = false;
  private pending: { meta: ShotMeta; w: number; h: number } | null = null;
  private restore: { fov: number } | null = null;
  private roll: Stored[] = [];
  private subjectInFrame = false;
  private shakeVel = 0;
  onShot: (meta: ShotMeta, subjectScored: boolean) => void = () => {};
  onRoll: (roll: RollShot[]) => void = () => {};
  onSound: (s: "shutter" | "focus" | "raise" | "lower" | "dial") => void = () => {};
  dofLevel = DepthOfFieldEffectBlurLevel.Medium;

  constructor(private engine: AbstractEngine, private canvas: HTMLCanvasElement, private pipeline: DefaultRenderingPipeline, private player: PlayerController) {}

  get aperture() { return APERTURES[this.ap]; }

  // ---------- geometry helpers ----------
  private basis() {
    const c = this.player.camera, yaw = c.rotation.y, pitch = c.rotation.x;
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    return { ox: c.position.x, oy: c.position.y, oz: c.position.z, fx: sy * cp, fy: -sp, fz: cy * cp, rx: cy, rz: -sy, ux: sy * sp, uy: cp, uz: cy * sp };
  }
  /** Project a world point into the 16:9 photo frame: x,y in [-1,1] when inside. */
  private project(b: ReturnType<PhotographySystem["basis"]>, x: number, y: number, z: number) {
    const dx = x - b.ox, dy = y - b.oy, dz = z - b.oz;
    const depth = dx * b.fx + dy * b.fy + dz * b.fz;
    const tv = Math.tan(this.lensFov / 2), th = tv * ASPECT;
    return { x: (dx * b.rx + dz * b.rz) / (Math.max(depth, 1e-3) * th), y: (dx * b.ux + dy * b.uy + dz * b.uz) / (Math.max(depth, 1e-3) * tv), depth };
  }
  /** Distance to whatever is under the centre of the frame. */
  private centreDistance(w: PhotoWorld): number {
    const b = this.basis();
    let best = rayBoxes(b.ox, b.oy, b.oz, b.fx, b.fy, b.fz, 150);
    if (b.fy < -1e-4) best = Math.min(best, (b.oy - groundY(b.ox, b.oz)) / -b.fy);
    const fl = Math.hypot(b.fx, b.fz);
    if (fl > 1e-4) {
      for (const n of w.npcs) {
        const px = n.x - b.ox, pz = n.z - b.oz;
        const along = (px * b.fx + pz * b.fz) / fl; // horizontal distance along the ray
        if (along < 0.3) continue;
        const perp = Math.abs(px * b.fz - pz * b.fx) / fl;
        if (perp > 0.32) continue;
        const t = along / fl, y = b.oy + b.fy * t, gy = groundY(n.x, n.z);
        if (y > gy - 0.1 && y < gy + 1.85 * n.visual.scale && t < best) best = t;
      }
    }
    for (const v of w.vehicleBoxes) {
      for (let t = 1; t < Math.min(best, 80); t += 0.5) {
        const x = b.ox + b.fx * t, z = b.oz + b.fz * t, y = b.oy + b.fy * t;
        if (y < 1.6 && y > 0 && x > v.x0 && x < v.x1 && z > v.z0 && z < v.z1) { best = t; break; }
      }
    }
    return clamp(best, 0.45, 150);
  }

  // ---------- per-frame ----------
  update(dt: number, input: Input, w: PhotoWorld, moving: number) {
    this.t += dt; this.cooldown -= dt;
    const pl = this.player, aiming = pl.aiming;
    if (aiming) {
      if (input.wheel) { this.focal = clamp(this.focal * Math.pow(1.12, -input.wheel), 24, 200); }
      const step = (cur: number, d: number, n: number) => { const v = clamp(cur + d, 0, n - 1); if (v !== cur) this.onSound("dial"); return v; };
      if (input.hit("apertureDown")) this.ap = step(this.ap, -1, APERTURES.length);
      if (input.hit("apertureUp")) this.ap = step(this.ap, 1, APERTURES.length);
      if (input.hit("shutterDown")) { this.sh = step(this.sh, -1, SHUTTERS.length); this.mode = "MANUAL"; }
      if (input.hit("shutterUp")) { this.sh = step(this.sh, 1, SHUTTERS.length); this.mode = "MANUAL"; }
      if (input.hit("isoDown")) { this.iso = step(this.iso, -1, ISOS.length); this.mode = "MANUAL"; }
      if (input.hit("isoUp")) { this.iso = step(this.iso, 1, ISOS.length); this.mode = "MANUAL"; }
      if (input.hit("compDown")) this.comp = clamp(Math.round((this.comp - 1 / 3) * 3) / 3, -2, 2);
      if (input.hit("compUp")) this.comp = clamp(Math.round((this.comp + 1 / 3) * 3) / 3, -2, 2);
      if (input.hit("grid")) this.grid = !this.grid;
      if (input.hit("afMode")) { this.af = this.af === "AF-C" ? "MF" : "AF-C"; this.onSound("dial"); }
      if (input.hit("shootMode")) {
        this.mode = this.mode === "PORTRAIT" ? "LANDSCAPE" : this.mode === "LANDSCAPE" ? "MANUAL" : "PORTRAIT";
        if (this.mode === "PORTRAIT") { this.ap = 0; this.af = "AF-C"; }
        if (this.mode === "LANDSCAPE") { this.ap = 5; this.af = "AF-C"; this.focal = Math.min(this.focal, 35); }
        this.onSound("dial");
      }
      if (input.is("focusNear")) { this.af = "MF"; this.focusDist = clamp(this.focusDist * Math.pow(0.5, dt), 0.45, 150); }
      if (input.is("focusFar")) { this.af = "MF"; this.focusDist = clamp(this.focusDist * Math.pow(2, dt), 0.45, 150); }
      this.battery = Math.max(0.03, this.battery - dt / 3600);
    }
    this.lensFov = 2 * Math.atan(12 / this.focal);

    // ----- exposure -----
    const N = this.aperture, ev = w.light.ev;
    if (this.mode === "MANUAL") { this.shutter = SHUTTERS[this.sh]; this.isoVal = ISOS[this.iso]; }
    else {
      let iso = 100, t = (N * N) / Math.pow(2, ev);
      if (t > 1 / 125) { iso = clamp(100 * (t / (1 / 125)), 100, 6400); iso = ISOS.find((i) => i >= iso - 1) ?? 6400; t = (N * N) / (Math.pow(2, ev) * (iso / 100)); }
      this.shutter = clamp(t, 1 / 8000, 1 / 15); this.isoVal = iso;
    }
    const light = (this.shutter * (this.isoVal / 100)) / (N * N);
    const delta = Math.log2(light * Math.pow(2, ev)) + (this.mode === "MANUAL" ? 0 : this.comp);
    this.meter = delta;

    // ----- focus -----
    const b = this.basis();
    let target = this.focusDist;
    this.subjectInFrame = false;
    let subjDist = 0;
    if (w.subject) {
      const s = w.subject, hy = groundY(s.x, s.z) + 1.6 * s.visual.scale;
      const pr = this.project(b, s.x, hy, s.z);
      subjDist = pr.depth;
      this.subjectInFrame = pr.depth > 0.3 && Math.abs(pr.x) < 1 && Math.abs(pr.y) < 1;
    }
    if (aiming) {
      const centre = this.centreDistance(w);
      let wantD = centre;
      if (this.mode === "PORTRAIT" && w.subject && this.subjectInFrame) {
        const s = w.subject, pr = this.project(b, s.x, groundY(s.x, s.z) + 1.5 * s.visual.scale, s.z);
        if (Math.abs(pr.x) < 0.45 && Math.abs(pr.y) < 0.6) wantD = pr.depth; // eye/face priority inside the AF area
      }
      if (this.mode === "LANDSCAPE") wantD = Math.max(wantD, 12);
      if (input.hit("focus")) { this.focusDist = wantD; this.onSound("focus"); }
      else if (this.af === "AF-C") this.focusDist = 1 / damp(1 / this.focusDist, 1 / wantD, 5.5, dt);
      target = wantD;
      this.focusLocked = Math.abs(1 / this.focusDist - 1 / target) < 0.02 + 0.012 * N / this.focal * 50;
    }

    // ----- camera shake (affects the image and the blur estimate) -----
    const amp = (0.0011 + 0.0035 * clamp(moving / 1.4, 0, 2)) * (aiming ? 1 : 0);
    const ny = Math.sin(this.t * 5.3) * 0.6 + Math.sin(this.t * 11.7 + 1.3) * 0.3 + Math.sin(this.t * 23.1) * 0.1;
    const np = Math.sin(this.t * 4.7 + 2) * 0.6 + Math.sin(this.t * 13.1) * 0.3 + Math.sin(this.t * 19.9 + 0.5) * 0.1;
    pl.shakeYaw = ny * amp; pl.shakePitch = np * amp;
    this.shakeVel = amp * 9; // rad/s, rough bound of the derivative above
    this.blurRisk = this.blurFraction(w.subject, subjDist) > 0.004;

    // viewfinder shows a 16:9 frame; widen the view on tall windows so the frame matches the lens
    const winAspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    pl.lensFov = winAspect >= ASPECT ? this.lensFov : 2 * Math.atan(Math.tan(this.lensFov / 2) * (ASPECT / winAspect));

    // ----- post-processing driven by the lens -----
    const p = this.pipeline, on = pl.aim > 0.5;
    if (on !== this.dofOn) { this.dofOn = on; p.depthOfFieldEnabled = on; if (on) p.depthOfFieldBlurLevel = this.dofLevel; p.imageProcessing.vignetteEnabled = on; p.grainEnabled = on; }
    if (on) {
      p.depthOfField.focalLength = this.focal; p.depthOfField.fStop = N; p.depthOfField.focusDistance = this.focusDist * 1000; p.depthOfField.lensSize = 50;
      p.imageProcessing.exposure = w.light.baseExposure * clamp(Math.pow(2, delta), 0.03, 12);
      p.grain.intensity = clamp(Math.log2(this.isoVal / 100) / 6, 0, 1) * 30; p.grain.animated = true;
      p.imageProcessing.vignetteWeight = 1.2 + (N < 2.8 ? 1.2 : 0);
    } else p.imageProcessing.exposure = w.light.baseExposure;

    // ----- shutter -----
    if (aiming && pl.aim > 0.95 && input.clickL && this.cooldown <= 0 && !this.pending) this.shoot(w, subjDist);
  }

  /** Motion blur as a fraction of frame width during the exposure. */
  private blurFraction(s: NPC | null, dist: number): number {
    const fovH = 2 * Math.atan(Math.tan(this.lensFov / 2) * ASPECT);
    let ang = this.shakeVel;
    if (s && dist > 0.3) {
      const b = this.basis();
      const rvx = s.vx - this.player.vx, rvz = s.vz - this.player.vz;
      ang += Math.abs(rvx * b.rx + rvz * b.rz) / dist;
    }
    return (ang * this.shutter) / fovH;
  }

  hud(w: PhotoWorld): CameraHud {
    return {
      focal: Math.round(this.focal), aperture: this.aperture, shutter: this.shutter, iso: this.isoVal, comp: this.mode === "MANUAL" ? 0 : this.comp,
      meter: clamp(this.meter, -3, 3), mode: this.mode, af: this.af, focusDist: this.focusDist, focusLocked: this.focusLocked,
      battery: this.battery, shots: this.shots, grid: this.grid, subject: w.subject?.name ?? null, subjectInFrame: this.subjectInFrame, blurRisk: this.blurRisk,
    };
  }

  // ---------- scoring (all terms come from measured simulation state) ----------
  private score(w: PhotoWorld, s: NPC, dist: number): ScoreBreakdown {
    const b = this.basis();
    const gy = groundY(s.x, s.z), H = 1.72 * s.visual.scale;
    const head = this.project(b, s.x, gy + H * 0.94, s.z), top = this.project(b, s.x, gy + H, s.z), feet = this.project(b, s.x, gy, s.z), mid = this.project(b, s.x, gy + H * 0.55, s.z);
    const parts: ScoreBreakdown["parts"] = [];
    const add = (key: string, label: string, v: number, max: number, note: string) => parts.push({ key, label, score: Math.round(clamp(v, 0, 1) * max), max, note });
    const inFront = head.depth > 0.3;

    // 1. position in frame
    const headIn = inFront && Math.abs(head.x) < 0.94 && Math.abs(top.y) < 0.97;
    const bodyIn = inFront ? clamp(1 - Math.max(0, Math.abs(mid.x) - 0.7) / 0.3, 0, 1) : 0;
    add("frame", "Position in frame", headIn ? 0.55 + 0.45 * bodyIn : inFront ? 0.2 * bodyIn : 0, 15, headIn ? "Subject inside the frame" : "Head is cut off or outside the frame");

    // 2. face visibility: facing + occlusion
    const faceYaw = s.yaw + s.anim.yawOff + s.anim.curLookYaw * 0.9;
    const toCam = Math.atan2(b.ox - s.x, b.oz - s.z);
    const facing = Math.cos(angDiff(faceYaw, toCam));
    let occl = 1;
    const sx = s.x - b.ox, sz = s.z - b.oz, sl = Math.hypot(sx, sz) || 1;
    for (const o of w.npcs) {
      if (o === s) continue;
      const ox = o.x - b.ox, oz = o.z - b.oz;
      const t = (ox * sx + oz * sz) / (sl * sl);
      if (t < 0.04 || t > 0.93) continue;
      if (Math.abs(ox * sz - oz * sx) / sl < 0.27) { occl = 0.3; break; }
    }
    for (const v of w.vehicleBoxes) for (let t = 0.1; t < 0.9; t += 0.1) { const x = b.ox + sx * t, z = b.oz + sz * t; if (x > v.x0 && x < v.x1 && z > v.z0 && z < v.z1) occl = Math.min(occl, 0.2); }
    const faceV = headIn ? clamp((facing + 0.15) / 0.95, 0, 1) * occl : 0;
    add("face", "Face visibility", faceV, 15, !headIn ? "Face not in frame" : occl < 1 ? "Someone is blocking the view" : facing > 0.6 ? "Face clearly visible" : "Subject is turned away");

    // 3. distance / size in frame
    const size = inFront ? Math.abs(top.y - feet.y) / 2 : 0; // body height as fraction of frame height
    const sizeS = size < 0.45 ? clamp((size - 0.12) / 0.33, 0, 1) : size > 2.6 ? clamp(1 - (size - 2.6) / 2, 0, 1) : 1;
    add("distance", "Distance", sizeS, 10, size < 0.45 ? "Too far — zoom in or step closer" : size > 2.6 ? "Too close" : `Good subject size (${dist.toFixed(1)} m)`);

    // 4. focus: circle of confusion on a full-frame sensor
    const f = this.focal, sF = this.focusDist * 1000, d = Math.max(300, dist * 1000);
    const coc = ((f * f) / (this.aperture * Math.max(1, sF - f))) * (Math.abs(d - sF) / d);
    add("focus", "Focus", 1 - (coc - 0.03) / 0.22, 20, coc < 0.04 ? "Tack sharp" : coc < 0.12 ? "Slightly soft" : "Out of focus");

    // 5. exposure
    const ex = Math.abs(this.meter);
    add("exposure", "Exposure", 1 - (ex - 0.35) / 1.9, 15, ex < 0.5 ? "Well exposed" : this.meter > 0 ? `Overexposed (+${ex.toFixed(1)} EV)` : `Underexposed (−${ex.toFixed(1)} EV)`);

    // 6. composition: thirds / centre, headroom
    const hx = Math.abs(head.x), thirds = 1 - Math.min(Math.abs(hx - 1 / 3), hx * 0.85) / 0.35;
    const eyeLine = 1 - Math.abs(head.y - 0.36) / 0.6; // eyes near the upper third
    const headroom = top.y < 0.97 && top.y > 0.15 ? 1 : 0.5;
    add("composition", "Composition", headIn ? thirds * 0.45 + clamp(eyeLine, 0, 1) * 0.35 + headroom * 0.2 : 0, 10, thirds > 0.75 && eyeLine > 0.6 ? "Strong placement" : "Try the rule of thirds");

    // 7. timing
    const blur = this.blurFraction(s, dist);
    const sharpMotion = 1 - (blur - 0.0015) / 0.011;
    const walking = s.state === "WALKING_FOR_PHOTO" || s.state === "CROSSING" || s.state === "WALKING";
    let timing: number, tnote: string;
    if (walking) {
      const stride = Math.abs(Math.sin(s.anim.phase));
      timing = clamp(sharpMotion, 0, 1) * 0.45 + stride * 0.3 + clamp(facing, 0, 1) * 0.25;
      tnote = blur > 0.006 ? "Motion blur — use a faster shutter" : stride > 0.75 ? "Caught mid-stride" : "Step timing could be better";
    } else {
      timing = clamp(sharpMotion, 0, 1) * 0.6 + (Math.abs(s.anim.yawOff - 0) < 3 ? 0.4 : 0);
      tnote = blur > 0.006 ? "Camera shake — hold still or raise the shutter speed" : "Steady shot";
    }
    add("timing", walking ? "Timing (moving)" : "Timing", timing, 10, tnote);

    // 8. pose
    const pose = s.anim.pose;
    const special = pose !== "none" && pose !== "nod" && pose !== "phone";
    const poseS = special ? (pose === "smile" ? 0.75 : 1) : s.anim.curSmile > 0.4 ? 0.6 : walking && facing > 0.6 ? 0.55 : 0.25;
    add("pose", "Pose", poseS, 5, special ? `Pose: ${pose}` : "No pose at the moment");

    const notes: string[] = [];
    let total = parts.reduce((a, p) => a + p.score, 0);
    if (w.unsafe) { total = Math.max(0, total - 20); notes.push("−20: taken from the roadway against the signal. Unsafe shots never score higher."); }
    return { total, parts, notes };
  }

  private shoot(w: PhotoWorld, subjDist: number) {
    this.cooldown = 0.45;
    this.onSound("shutter");
    const [rw, rh] = RES[(this.resolution as PhotoRes)] ?? RES["1080"];
    const max = this.engine.getCaps().maxTextureSize || 4096;
    const k = Math.min(1, max / rw);
    const s = w.subject;
    const scored = !!s && this.subjectInFrame && !!s.session;
    const score = scored ? this.score(w, s!, subjDist) : null;
    this.shots++;
    this.battery = Math.max(0.03, this.battery - 0.004);
    const meta: ShotMeta = {
      id: `${Date.now()}-${this.shots}`, fileBase: nextPhotoFileBase(), takenAt: Date.now(), width: Math.round(rw * k), height: Math.round(rh * k),
      npcName: scored ? s!.name : null, portraitType: scored ? (s!.session!.type === "walk" ? "walking" : "static") : null, score,
      focal: Math.round(this.focal), aperture: this.aperture, shutter: this.shutter, iso: this.isoVal, comp: this.mode === "MANUAL" ? 0 : this.comp,
      mode: this.mode, time: w.time, weather: w.weather,
    };
    this.pending = { meta, w: meta.width, h: meta.height };
    this.onShot(meta, scored);
  }
  resolution: PhotoRes = "1080";

  // ---------- real frame capture ----------
  /** Call right before scene.render(): renders the next frame at photo resolution, exactly as the lens sees it. */
  beforeRender() {
    if (this.pending && this.restore) { this.player.camera.fov = this.lensFov; return; }
    if (!this.pending || this.restore) return;
    const cam = this.player.camera;
    this.restore = { fov: cam.fov };
    this.sizedFrames = 0;
    this.engine.setSize(this.pending.w, this.pending.h);
    cam.fov = this.lensFov;
  }
  private reading: Promise<ArrayBufferView> | null = null;
  private sizedFrames = 0; private failed = false;
  /** Call when the scene (including post-processing) has been drawn, still inside the frame: read the real pixels back. */
  afterSceneRender() {
    if (!this.pending || !this.restore || this.reading) return;
    // the first frame after a resize is not reliable (render targets are being rebuilt): read the third one
    if (++this.sizedFrames < 3) return;
    try { this.reading = this.engine.readPixels(0, 0, this.pending.w, this.pending.h, true, true); } catch (e) { console.warn("readPixels failed", e); this.failed = true; }
  }
  /** Call after the frame was presented (engine end-of-frame). */
  afterRender() {
    if (!this.pending || !this.restore) return;
    if (!this.reading && !this.failed) return; // still waiting for a stable frame at photo resolution
    const { meta, w, h } = this.pending;
    const out = document.createElement("canvas"); out.width = w; out.height = h;
    const g = out.getContext("2d")!;
    const reading = this.reading;
    this.failed = false;
    this.player.camera.fov = this.restore.fov;
    this.restore = null; this.pending = null; this.reading = null;
    this.engine.resize();
    const finish = (canvas: HTMLCanvasElement) => {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const tc = document.createElement("canvas"); tc.width = 480; tc.height = 270;
        tc.getContext("2d")!.drawImage(canvas, 0, 0, 480, 270);
        tc.toBlob((thumb) => { if (thumb) this.store(meta, blob, thumb); }, "image/jpeg", 0.82);
      }, "image/png");
    };
    const fallback = () => {
      CreateScreenshotUsingRenderTargetAsync(this.engine, this.player.camera, { width: w, height: h }, "image/png", 1, false).then((dataUrl) => {
        const img = new Image();
        img.onload = () => { g.fillStyle = "#000"; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); finish(out); };
        img.src = dataUrl;
      }).catch((e) => console.error("Photo capture failed", e));
    };
    if (!reading) { fallback(); return; }
    reading.then((buf) => {
      const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      if (src.length < w * h * 4) { fallback(); return; }
      const img = g.createImageData(w, h), dst = img.data;
      // WebGL returns rows bottom-up, WebGPU top-down; alpha is forced opaque (the back buffer may carry alpha 0)
      const flip = !this.engine.isWebGPU, row = w * 4;
      let sum = 0;
      for (let y = 0; y < h; y++) {
        const so = (flip ? h - 1 - y : y) * row, d0 = y * row;
        for (let x = 0; x < row; x += 4) { dst[d0 + x] = src[so + x]; dst[d0 + x + 1] = src[so + x + 1]; dst[d0 + x + 2] = src[so + x + 2]; dst[d0 + x + 3] = 255; }
        if (y % 16 === 0) for (let x = 0; x < row; x += 404) sum += src[so + x] + src[so + x + 1];
      }
      if (sum === 0) { fallback(); return; }
      g.putImageData(img, 0, 0);
      finish(out);
    }).catch((e) => { console.warn("Pixel readback failed, using render-target capture", e); fallback(); });
  }
  get capturing() { return !!this.pending; }

  private store(meta: ShotMeta, blob: Blob, thumb: Blob) {
    this.roll.unshift({ meta, blob, thumb, url: URL.createObjectURL(blob), thumbUrl: URL.createObjectURL(thumb), saved: false });
    while (this.roll.length > 14) { const o = this.roll.pop()!; URL.revokeObjectURL(o.url); URL.revokeObjectURL(o.thumbUrl); }
    this.pushRoll();
  }
  private pushRoll() { this.onRoll(this.roll.map((r) => ({ meta: r.meta, url: r.url, thumbUrl: r.thumbUrl, saved: r.saved }))); }
  getShot(id: string) { return this.roll.find((r) => r.meta.id === id) ?? null; }
  discard(id: string) {
    const i = this.roll.findIndex((r) => r.meta.id === id);
    if (i < 0) return;
    const [o] = this.roll.splice(i, 1); URL.revokeObjectURL(o.url); URL.revokeObjectURL(o.thumbUrl);
    this.pushRoll();
  }
  markSaved(id: string) { const r = this.getShot(id); if (r) { r.saved = true; this.pushRoll(); } }
}

export function shutterLabel(t: number): string {
  if (t >= 0.5) return `${t.toFixed(1)}s`;
  const stops = [15, 30, 60, 125, 250, 500, 1000, 2000, 4000, 8000];
  const inv = 1 / t; let best = stops[0];
  for (const s of stops) if (Math.abs(Math.log2(s / inv)) < Math.abs(Math.log2(best / inv))) best = s;
  return `1/${best}`;
}
