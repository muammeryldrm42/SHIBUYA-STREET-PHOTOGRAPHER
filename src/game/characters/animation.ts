// Procedural skeletal animation: locomotion driven by distance travelled (no foot sliding),
// pose overlays blended on the upper body, head look-at, blinking and smiling.
import { Quaternion, Vector3, Space } from "@babylonjs/core";
import { B, CharacterVisual } from "./CharacterFactory";
import { clamp, damp } from "../world/layout";

export type PoseId =
  | "none" | "smile" | "peace" | "wave" | "pockets" | "fixJacket" | "sideTurn" | "backTurn" | "bow" | "phone"
  | "cheer" | "cameraUp" | "interact" | "decline" | "armsCrossed" | "nod" | "umbrella" | "hipHand";

export interface AnimState {
  phase: number; speed: number; t: number; seed: number;
  pose: PoseId; lookYaw: number; lookPitch: number; looking: boolean;
  smile: number; lean: number; umbrella: boolean; phoneIdle: boolean; stiffR: boolean;
  // outputs / internal
  cur: Float32Array; curLookYaw: number; curLookPitch: number; curSmile: number; yawOff: number; blink: number; nextBlink: number;
}

export function newAnim(seed: number): AnimState {
  return {
    phase: seed * 6.28, speed: 0, t: seed * 10, seed, pose: "none", lookYaw: 0, lookPitch: 0, looking: false,
    smile: 0, lean: 0, umbrella: false, phoneIdle: false, stiffR: false,
    cur: new Float32Array(B.COUNT * 3), curLookYaw: 0, curLookPitch: 0, curSmile: 0, yawOff: 0, blink: 0, nextBlink: 1 + seed * 3,
  };
}

type PoseDef = { [bone: number]: [number, number, number] } & { yaw?: number; smile?: number; noLook?: boolean };
const P = (d: PoseDef) => d;
function poseDef(id: PoseId, t: number): PoseDef | null {
  const s = Math.sin;
  switch (id) {
    case "smile": return P({ [B.HEAD]: [0, 0, 0.09], smile: 1 });
    case "peace": return P({ [B.ARM_R]: [-0.75, 0, 0.5], [B.FORE_R]: [-2.05, 0, 0.1], [B.HEAD]: [0, 0, -0.1], smile: 1 });
    case "wave": return P({ [B.ARM_R]: [-0.2, 0, 2.2], [B.FORE_R]: [0, 0, 0.5 + s(t * 9) * 0.4], smile: 1 });
    case "pockets": return P({ [B.ARM_L]: [0.22, 0, -0.1], [B.FORE_L]: [-0.5, 0, 0.3], [B.ARM_R]: [0.22, 0, 0.1], [B.FORE_R]: [-0.5, 0, -0.3], smile: 0.5 });
    case "fixJacket": return P({ [B.ARM_L]: [-0.35, 0, -0.3], [B.FORE_L]: [-1.85 + s(t * 3) * 0.08, 0, 0.75], [B.ARM_R]: [-0.35, 0, 0.3], [B.FORE_R]: [-1.85 - s(t * 3) * 0.08, 0, -0.75], smile: 0.4 });
    case "hipHand": return P({ [B.ARM_R]: [0.1, 0, 0.62], [B.FORE_R]: [-0.35, 0, -1.45], [B.HIPS]: [0, 0, 0.05], smile: 0.8 });
    case "sideTurn": return P({ [B.ARM_R]: [0.1, 0, 0.6], [B.FORE_R]: [-0.35, 0, -1.4], yaw: 0.85, smile: 0.7 });
    case "backTurn": return P({ [B.ARM_L]: [0.15, 0, -0.12], [B.CHEST]: [0, -0.35, 0], yaw: 2.35, smile: 0.6 });
    case "bow": return P({ [B.SPINE]: [0.42, 0, 0], [B.CHEST]: [0.22, 0, 0], [B.HEAD]: [0.15, 0, 0], noLook: true });
    case "phone": return P({ [B.ARM_R]: [-0.5, 0, 0.12], [B.FORE_R]: [-1.55, 0, -0.35], [B.HEAD]: [0.38, 0, 0], [B.NECK]: [0.12, 0, 0], noLook: true });
    case "cheer": return P({ [B.ARM_L]: [-0.2, 0, -2.5], [B.FORE_L]: [0, 0, -0.3], [B.ARM_R]: [-0.2, 0, 2.5], [B.FORE_R]: [0, 0, 0.3], smile: 1 });
    case "cameraUp": return P({ [B.ARM_L]: [-1.2, 0, 0.3], [B.FORE_L]: [-1.75, 0, 0.85], [B.ARM_R]: [-1.2, 0, -0.3], [B.FORE_R]: [-1.75, 0, -0.85], [B.HEAD]: [0.06, 0, 0] });
    case "interact": return P({ [B.ARM_R]: [-0.65, 0, 0.2], [B.FORE_R]: [-1.05 + s(t * 5) * 0.2, 0, -0.1], smile: 0.6 });
    case "decline": return P({ [B.ARM_R]: [-0.7, 0, 0.25], [B.FORE_R]: [-1.75, 0, -0.35 + s(t * 11) * 0.3], [B.SPINE]: [0.12, 0, 0], [B.HEAD]: [0.12, 0, 0] });
    case "armsCrossed": return P({ [B.ARM_L]: [-0.3, 0, -0.18], [B.FORE_L]: [-1.5, 0, 1.25], [B.ARM_R]: [-0.3, 0, 0.18], [B.FORE_R]: [-1.5, 0, -1.25] });
    case "nod": return P({ [B.HEAD]: [0.12 + s(t * 9) * 0.14, 0, 0], smile: 0.8 });
    case "umbrella": return P({ [B.ARM_R]: [-0.5, 0, 0.12], [B.FORE_R]: [-1.8, 0, -0.2] });
    default: return null;
  }
}

const q = new Quaternion();
const v = new Vector3();
const tgt = new Float32Array(B.COUNT * 3);
const UPPER = [B.SPINE, B.CHEST, B.NECK, B.HEAD, B.ARM_L, B.FORE_L, B.HAND_L, B.ARM_R, B.FORE_R, B.HAND_R];

/** Advance and apply the animation. `moved` is the ground distance covered this frame. */
export function animate(c: CharacterVisual, a: AnimState, dt: number, moved: number) {
  a.t += dt;
  const sp = a.speed;
  const run = clamp((sp - 2.4) / 1.6, 0, 1);
  const w = clamp(sp / 1.2, 0, 1); // walk amount
  const stride = (1.25 + 1.3 * run) * c.scale;
  a.phase += (moved / stride) * Math.PI * 2;
  const p = a.phase, sn = Math.sin(p), cs = Math.cos(p), t = a.t;
  tgt.fill(0);
  const set = (b: number, x: number, y: number, z: number) => { tgt[b * 3] = x; tgt[b * 3 + 1] = y; tgt[b * 3 + 2] = z; };

  // ----- locomotion -----
  const A = (0.42 + 0.38 * run) * w, K = (0.95 + 0.75 * run) * w;
  const idle = 1 - w, breath = Math.sin(t * 1.4 + a.seed * 5);
  const sway = Math.sin(t * 0.45 + a.seed * 9) * 0.035 * idle;
  set(B.HIPS, 0.02 * run, sn * 0.07 * w, cs * 0.03 * w + sway + a.lean * 0.5);
  set(B.SPINE, 0.03 + 0.1 * run + breath * 0.008, 0, -sway * 0.6 - a.lean * 0.3);
  set(B.CHEST, 0.02 + breath * 0.012, -sn * 0.11 * w, -cs * 0.02 * w);
  set(B.THIGH_L, -sn * A - 0.06 * run, 0, -sway * 0.5);
  set(B.THIGH_R, sn * A - 0.06 * run, 0, -sway * 0.5);
  set(B.SHIN_L, 0.06 * w + K * Math.pow(Math.max(0, cs), 1.4), 0, 0);
  set(B.SHIN_R, 0.06 * w + K * Math.pow(Math.max(0, -cs), 1.4), 0, 0);
  set(B.FOOT_L, -0.18 * w * Math.max(0, -sn) + 0.25 * w * Math.max(0, cs), 0, 0);
  set(B.FOOT_R, -0.18 * w * Math.max(0, sn) + 0.25 * w * Math.max(0, -cs), 0, 0);
  const armA = (0.36 + 0.5 * run) * w, bend = 0.18 + 0.12 * w + 1.15 * run;
  set(B.ARM_L, sn * armA + 0.03, 0, -0.07 - 0.02 * idle * breath);
  set(B.ARM_R, a.stiffR ? 0.03 : -sn * armA + 0.03, 0, 0.07 + 0.02 * idle * breath);
  set(B.FORE_L, -bend - Math.max(0, -sn) * 0.25 * w, 0, 0);
  set(B.FORE_R, a.stiffR ? -0.08 : -bend - Math.max(0, sn) * 0.25 * w, 0, 0);

  // ----- pose overlay -----
  let pose: PoseDef | null = poseDef(a.pose, t);
  if (!pose && a.umbrella) pose = poseDef("umbrella", t);
  else if (pose && a.umbrella && pose[B.ARM_R] === undefined) pose = { ...poseDef("umbrella", t)!, ...pose };
  if (!pose && a.phoneIdle) pose = poseDef("phone", t);
  let yawT = 0, smileT = a.smile, noLook = false;
  if (pose) {
    for (const b of UPPER) { const d = pose[b]; if (d) set(b, d[0], d[1], d[2]); }
    if (pose[B.HIPS]) { tgt[B.HIPS * 3 + 2] += pose[B.HIPS][2]; }
    yawT = pose.yaw ?? 0; smileT = Math.max(smileT, pose.smile ?? 0); noLook = !!pose.noLook;
  }
  a.yawOff = damp(a.yawOff, yawT, 4, dt);

  // ----- head look -----
  const ly = a.looking && !noLook ? clamp(a.lookYaw - a.yawOff, -1.25, 1.25) : 0;
  const lp = a.looking && !noLook ? clamp(a.lookPitch, -0.5, 0.5) : 0;
  a.curLookYaw = damp(a.curLookYaw, ly, 7, dt); a.curLookPitch = damp(a.curLookPitch, lp, 7, dt);
  tgt[B.NECK * 3] += a.curLookPitch * 0.4; tgt[B.NECK * 3 + 1] += a.curLookYaw * 0.4;
  tgt[B.HEAD * 3] += a.curLookPitch * 0.6; tgt[B.HEAD * 3 + 1] += a.curLookYaw * 0.5;
  tgt[B.CHEST * 3 + 1] += a.curLookYaw * 0.12;

  // ----- smooth the upper body, apply -----
  const k = 1 - Math.exp(-13 * dt);
  for (const b of UPPER) for (let i = 0; i < 3; i++) { const j = b * 3 + i; a.cur[j] += (tgt[j] - a.cur[j]) * k; }
  const bones = c.bones;
  for (let b = 0; b < B.EYES; b++) {
    const up = b >= B.SPINE && b <= B.HAND_R;
    const src = up ? a.cur : tgt, j = b * 3;
    Quaternion.RotationYawPitchRollToRef(src[j + 1], src[j], src[j + 2], q);
    bones[b].setRotationQuaternion(q, Space.LOCAL);
  }
  // hips bob (down at double support, up at mid-stance)
  const bob = (-0.018 + 0.03 * Math.abs(cs)) * w * (1 + run) - 0.004 * idle * (1 + breath);
  const r = c.rest[B.HIPS];
  v.set(r[0], r[1] + bob, r[2]);
  bones[B.HIPS].setPosition(v, Space.LOCAL);

  // ----- face -----
  a.curSmile = damp(a.curSmile, smileT, 6, dt);
  v.set(1 + a.curSmile * 0.42, 1 + a.curSmile * 0.9, 1);
  bones[B.MOUTH].setScale(v);
  a.nextBlink -= dt;
  if (a.nextBlink < 0) { a.blink = 0.13; a.nextBlink = 2 + ((a.seed * 97 + t) % 3.5); }
  a.blink = Math.max(0, a.blink - dt);
  const open = a.blink > 0 ? 0.12 : 1 - a.curSmile * 0.22;
  v.set(1, open, 1);
  bones[B.EYES].setScale(v);
}
