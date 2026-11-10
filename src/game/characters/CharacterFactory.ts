// Builds a skinned, rigged human from a "look" description. One mesh + one skeleton per character.
import { Mesh, Scene, Skeleton, Bone, Matrix, PBRMaterial, Color3, Vector3 } from "@babylonjs/core";
import { Geo, RGB, V3, W, Ring, hex, shade, mix } from "./Geo";
import { mulberry } from "../world/layout";

export const B = {
  HIPS: 0, SPINE: 1, CHEST: 2, NECK: 3, HEAD: 4,
  ARM_L: 5, FORE_L: 6, HAND_L: 7, ARM_R: 8, FORE_R: 9, HAND_R: 10,
  THIGH_L: 11, SHIN_L: 12, FOOT_L: 13, THIGH_R: 14, SHIN_R: 15, FOOT_R: 16,
  EYES: 17, MOUTH: 18, COUNT: 19,
};

export type Archetype = "fashion" | "harajuku" | "tourist" | "student" | "business" | "influencer" | "casual" | "photographer";
export type HairStyle = "short" | "bob" | "long" | "pony" | "twin" | "bun" | "buzz" | "bangs";
export type TopStyle = "tee" | "long" | "hoodie" | "jacket" | "blazer" | "coat";
export type BottomStyle = "pants" | "wide" | "shorts" | "skirt" | "longskirt";

export interface Look {
  arche: Archetype; female: boolean; height: number; build: number;
  skin: RGB; hair: RGB; hairStyle: HairStyle; lip: RGB;
  top: TopStyle; topCol: RGB; innerCol: RGB; tie: RGB | null;
  bottom: BottomStyle; bottomCol: RGB; legCol: RGB | null; shoes: RGB; platform: boolean;
  hat: "none" | "cap" | "beanie" | "bucket"; hatCol: RGB;
  backpack: RGB | null; tote: RGB | null; briefcase: boolean; phone: boolean;
  sunglasses: boolean; mask: boolean; headphones: boolean; scarf: RGB | null; camera: boolean;
}

export interface CharacterVisual {
  mesh: Mesh; skeleton: Skeleton; bones: Bone[]; rest: V3[]; look: Look; scale: number;
  dispose(): void;
}

const SKINS = ["#f6d9c2", "#f1cdb0", "#ecc3a2", "#e2b48e", "#d3a07a", "#f8dfcc", "#c68e68", "#8f5f43"].map(hex);
const HAIR_NAT = ["#17130f", "#1e1712", "#2a1e16", "#3a2a1c", "#14110f", "#4a3422"].map(hex);
const HAIR_DYE = ["#c9a66b", "#e8b4c8", "#b9c4d6", "#7aa6d8", "#d8d2c4", "#b0563c", "#8fd0b6", "#c79bd9"].map(hex);
const NEUTRAL = ["#1b1c20", "#2b2d33", "#3c4048", "#6b6f78", "#d9d6cf", "#f1efe9", "#8a7f70", "#4a3f35", "#27384a", "#59636e"].map(hex);
const DENIM = ["#2f486b", "#3d5d86", "#1f2c44", "#6f8db3", "#20242c"].map(hex);
const VIVID = ["#d8433f", "#e58a2e", "#e7c53b", "#3f8f5f", "#3b79c4", "#7c56b8", "#d75a94", "#22a7a0"].map(hex);
const PASTEL = ["#f6b9cf", "#bfe3f2", "#d9c8f2", "#fbe3a8", "#c2ecd1", "#ffd0b8", "#ffffff"].map(hex);
const EARTH = ["#8a6a4a", "#b89b72", "#5d6b4a", "#a5553a", "#d8c7a6", "#6c5a48", "#3f4a3a"].map(hex);
const SUIT = ["#1c2230", "#23272e", "#2f3540", "#3a3f4a", "#1a1b1f"].map(hex);
const WHITE = hex("#f2f1ec"), BLACKISH = hex("#17181b");

export function randomLook(seed: number, arche?: Archetype): Look {
  const r = mulberry(seed * 7919 + 13);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const chance = (p: number) => r() < p;
  const a: Archetype = arche ?? pick<Archetype>(["fashion", "fashion", "harajuku", "tourist", "student", "business", "business", "influencer", "casual", "casual", "casual"]);
  const female = a === "harajuku" ? chance(0.75) : a === "business" ? chance(0.35) : chance(0.52);
  const L: Look = {
    arche: a, female, height: (female ? 1.57 : 1.71) + r() * 0.12, build: 0.94 + r() * 0.14,
    skin: pick(SKINS.slice(0, 6)), hair: pick(HAIR_NAT), hairStyle: "short", lip: hex("#b8615f"),
    top: "tee", topCol: pick(NEUTRAL), innerCol: WHITE, tie: null,
    bottom: "pants", bottomCol: pick(DENIM), legCol: null, shoes: pick([WHITE, BLACKISH, hex("#3a2f28"), hex("#c9c4b8")]), platform: false,
    hat: "none", hatCol: pick(NEUTRAL), backpack: null, tote: null, briefcase: false, phone: chance(0.18),
    sunglasses: false, mask: chance(0.12), headphones: chance(0.07), scarf: null, camera: false,
  };
  L.hairStyle = female ? pick<HairStyle>(["bob", "long", "long", "pony", "bangs", "bun", "bob"]) : pick<HairStyle>(["short", "short", "bangs", "buzz", "short"]);
  switch (a) {
    case "fashion":
      L.top = pick<TopStyle>(["coat", "jacket", "long", "blazer"]); L.topCol = pick([...EARTH, ...NEUTRAL]); L.innerCol = pick([WHITE, BLACKISH, ...EARTH]);
      L.bottom = female ? pick<BottomStyle>(["wide", "longskirt", "skirt", "pants"]) : pick<BottomStyle>(["wide", "pants"]);
      L.bottomCol = pick([...NEUTRAL, ...EARTH]); L.tote = chance(0.55) ? pick([...EARTH, BLACKISH]) : null;
      L.hat = chance(0.25) ? pick<Look["hat"]>(["beanie", "bucket"]) : "none"; L.sunglasses = chance(0.2);
      if (chance(0.2)) L.hair = pick(HAIR_DYE.slice(0, 2));
      break;
    case "harajuku":
      L.hair = pick(HAIR_DYE); L.hairStyle = female ? pick<HairStyle>(["twin", "twin", "bangs", "bun", "long"]) : pick<HairStyle>(["bangs", "short"]);
      L.top = pick<TopStyle>(["hoodie", "jacket", "long", "tee"]); L.topCol = pick([...PASTEL, ...VIVID]); L.innerCol = pick([...PASTEL, ...VIVID]);
      L.bottom = female ? pick<BottomStyle>(["skirt", "skirt", "shorts", "wide"]) : pick<BottomStyle>(["wide", "shorts"]);
      L.bottomCol = pick([...PASTEL, ...VIVID, BLACKISH]); L.legCol = chance(0.6) ? pick([WHITE, BLACKISH, ...PASTEL, ...VIVID]) : null;
      L.shoes = pick([...PASTEL, ...VIVID, WHITE, BLACKISH]); L.platform = chance(0.7);
      L.backpack = chance(0.45) ? pick([...PASTEL, ...VIVID]) : null; L.headphones = chance(0.25); L.mask = chance(0.15);
      L.lip = hex("#d2507a");
      break;
    case "tourist":
      L.skin = pick(SKINS); L.hair = pick([...HAIR_NAT, hex("#c9a66b"), hex("#8a5a34"), hex("#b0563c")]);
      L.top = pick<TopStyle>(["tee", "tee", "long", "hoodie"]); L.topCol = pick([...VIVID, ...NEUTRAL, WHITE]);
      L.bottom = pick<BottomStyle>(["shorts", "pants", "pants"]); L.bottomCol = pick([...EARTH, ...DENIM]);
      L.backpack = chance(0.75) ? pick([...VIVID, ...NEUTRAL]) : null; L.hat = chance(0.45) ? "cap" : "none"; L.hatCol = pick([...VIVID, ...NEUTRAL]);
      L.sunglasses = chance(0.3); L.camera = chance(0.4); L.mask = false; L.height += 0.04;
      break;
    case "student":
      L.height -= 0.04; L.top = "blazer"; L.topCol = pick([hex("#1d2740"), hex("#22262e"), hex("#3a2a2a")]); L.innerCol = WHITE;
      L.tie = pick([hex("#8f2230"), hex("#28407a"), hex("#2f5f3f")]);
      L.bottom = female ? "skirt" : "pants"; L.bottomCol = female ? pick([hex("#2a3350"), hex("#4a4f5c"), hex("#3f2d33")]) : hex("#2a2d36");
      L.legCol = female ? pick([hex("#1b1c22"), WHITE]) : null; L.shoes = pick([hex("#2a1e18"), BLACKISH]);
      L.backpack = chance(0.6) ? pick([BLACKISH, hex("#27384a"), hex("#6a2d38")]) : null; L.tote = !L.backpack && chance(0.6) ? hex("#27304a") : null;
      L.hairStyle = female ? pick<HairStyle>(["bob", "pony", "long", "bangs"]) : pick<HairStyle>(["short", "bangs"]);
      break;
    case "business":
      L.top = "blazer"; L.topCol = pick(SUIT); L.innerCol = pick([WHITE, hex("#dfe7f2")]); L.tie = female ? null : pick([hex("#7a1f2b"), hex("#1f3a6b"), hex("#3b3f48"), hex("#5a4a1f")]);
      L.bottom = female && chance(0.5) ? "skirt" : "pants"; L.bottomCol = L.topCol; L.legCol = L.bottom === "skirt" ? hex("#c9a58c") : null;
      L.shoes = pick([BLACKISH, hex("#2a1e18")]); L.briefcase = chance(0.55); L.tote = !L.briefcase && female && chance(0.6) ? BLACKISH : null;
      L.hairStyle = female ? pick<HairStyle>(["bob", "pony", "bun"]) : pick<HairStyle>(["short", "short", "buzz"]); L.phone = chance(0.25); L.headphones = false;
      if (chance(0.3)) { L.top = "coat"; L.topCol = pick([hex("#b89b72"), hex("#23272e"), hex("#3a3f4a")]); }
      break;
    case "influencer":
      L.hair = chance(0.5) ? pick(HAIR_DYE.slice(0, 5)) : pick(HAIR_NAT); L.hairStyle = female ? pick<HairStyle>(["long", "long", "bangs", "pony"]) : pick<HairStyle>(["bangs", "short"]);
      L.top = pick<TopStyle>(["jacket", "long", "tee", "coat"]); L.topCol = pick([WHITE, BLACKISH, ...PASTEL, ...VIVID.slice(0, 3)]); L.innerCol = pick([WHITE, BLACKISH]);
      L.bottom = female ? pick<BottomStyle>(["skirt", "wide", "shorts"]) : pick<BottomStyle>(["wide", "pants"]); L.bottomCol = pick([WHITE, BLACKISH, ...DENIM]);
      L.sunglasses = chance(0.5); L.phone = true; L.tote = chance(0.5) ? pick([WHITE, BLACKISH, ...PASTEL]) : null; L.shoes = pick([WHITE, ...VIVID]); L.platform = female && chance(0.4); L.mask = false;
      L.lip = hex("#c2374f");
      break;
    case "casual":
      L.top = pick<TopStyle>(["tee", "long", "hoodie", "jacket"]); L.topCol = pick([...NEUTRAL, ...EARTH, ...VIVID.slice(2, 6)]); L.innerCol = pick([WHITE, ...NEUTRAL]);
      L.bottom = female ? pick<BottomStyle>(["pants", "wide", "skirt", "longskirt"]) : pick<BottomStyle>(["pants", "pants", "wide", "shorts"]);
      L.bottomCol = pick([...DENIM, ...NEUTRAL, ...EARTH]); L.backpack = chance(0.3) ? pick(NEUTRAL) : null; L.tote = !L.backpack && chance(0.35) ? pick([...EARTH, ...NEUTRAL]) : null;
      L.hat = chance(0.15) ? pick<Look["hat"]>(["cap", "beanie"]) : "none";
      break;
    case "photographer":
      L.female = false; L.height = 1.76; L.build = 1; L.skin = SKINS[1]; L.hair = HAIR_NAT[1]; L.hairStyle = "bangs";
      L.top = "jacket"; L.topCol = hex("#2a2e33"); L.innerCol = hex("#d9d6cf"); L.bottom = "pants"; L.bottomCol = hex("#3b3f46");
      L.shoes = hex("#e9e6df"); L.backpack = hex("#8a5a2b"); L.camera = true; L.mask = false; L.phone = false; L.headphones = false; L.hat = "none"; L.tote = null;
      break;
  }
  if (L.bottom !== "skirt" && L.bottom !== "shorts") L.legCol = null;
  return L;
}

let sharedMat: PBRMaterial | null = null;
export function characterMaterial(scene: Scene): PBRMaterial {
  if (sharedMat && sharedMat.getScene() === scene) return sharedMat;
  const m = new PBRMaterial("characterMat", scene);
  m.albedoColor = Color3.White(); m.metallic = 0; m.roughness = 0.72;
  m.backFaceCulling = false; m.twoSidedLighting = true;
  m.environmentIntensity = 0.6;
  sharedMat = m;
  return m;
}

const TAU = Math.PI * 2, FRONT = Math.PI / 2;

/** Builds the geometry. `seg` controls radial resolution (lower for distant impostors). */
export function buildGeo(L: Look, seg = 14): { geo: Geo; joints: V3[] } {
  const g = new Geo();
  const f = L.female, bw = L.build;
  const sw = (f ? 0.162 : 0.19) * bw, hw = (f ? 0.168 : 0.158) * bw, waist = (f ? 0.118 : 0.142) * bw, chest = (f ? 0.158 : 0.182) * bw;
  const legX = 0.086 * bw;
  const J: V3[] = [];
  J[B.HIPS] = [0, 0.95, 0]; J[B.SPINE] = [0, 1.07, 0]; J[B.CHEST] = [0, 1.22, 0]; J[B.NECK] = [0, 1.45, 0]; J[B.HEAD] = [0, 1.52, 0];
  for (const s of [-1, 1]) {
    const o = s < 0 ? 0 : 3;
    J[B.ARM_L + o] = [s * (sw + 0.03), 1.39, 0]; J[B.FORE_L + o] = [s * (sw + 0.055), 1.13, 0]; J[B.HAND_L + o] = [s * (sw + 0.065), 0.885, 0];
    J[B.THIGH_L + o] = [s * legX, 0.93, 0]; J[B.SHIN_L + o] = [s * legX, 0.5, 0]; J[B.FOOT_L + o] = [s * legX, 0.08, 0];
  }
  const HS = 1.17, HY = 1.52; // head scale, head base
  J[B.EYES] = [0, HY + 0.115 * HS, 0.07]; J[B.MOUTH] = [0, HY + 0.05 * HS, 0.07];

  const ring = (c: V3, rx: number, rz: number, col: Ring["col"], w: Ring["w"], extra?: Partial<Ring>): Ring => ({ c, u: [rx, 0, 0], v: [0, 0, rz], col, w, ...extra });

  // ---------- Legs ----------
  const skirt = L.bottom === "skirt" || L.bottom === "longskirt";
  const wide = L.bottom === "wide";
  const legBase = skirt ? (L.legCol ?? L.skin) : L.bottomCol;
  const pantEnd = L.bottom === "shorts" ? 0.62 : 0.06;
  const sock = L.bottom === "shorts" ? (L.legCol ?? null) : null;
  const pf = L.platform ? 0.035 : 0;
  for (const s of [-1, 1]) {
    const o = s < 0 ? 0 : 3, TH = B.THIGH_L + o, SH = B.SHIN_L + o, FT = B.FOOT_L + o, x = s * legX;
    const lc = (y: number): RGB => {
      if (skirt) return y < 0.3 && L.legCol && L.legCol !== L.skin ? L.legCol : (L.legCol ?? L.skin);
      if (y >= pantEnd) return L.bottomCol;
      return sock && y < 0.26 ? sock : L.skin;
    };
    const k = (y: number, r: number) => (!skirt && y >= pantEnd ? (wide ? Math.max(r * 1.18, 0.07 * bw + (0.86 - y) * 0.03) : r * 1.08) : r) * bw;
    const def: [number, number, W][] = [
      [0.075, 0.04, [[SH, 1]]], [0.2, 0.047, [[SH, 1]]], [0.34, 0.055, [[SH, 1]]], [0.44, 0.05, [[SH, 1]]],
      [0.5, 0.052, [[SH, 0.5], [TH, 0.5]]], [0.56, 0.058, [[TH, 1]]], [0.62, 0.064, [[TH, 1]]], [0.74, 0.074, [[TH, 1]]],
      [0.86, 0.082, [[TH, 0.7], [B.HIPS, 0.3]]], [0.94, 0.078, [[B.HIPS, 1]]],
    ];
    const cols = new Map<string, RGB>();
    const cc = (y: number) => { const c = lc(y + 0.01); const key = c.join(); if (!cols.has(key)) cols.set(key, c); return cols.get(key)!; };
    void legBase;
    g.tube(def.map(([y, r, w]) => ring([x, y + pf, 0], k(y, r), k(y, r) * 1.06, cc(y), w)), seg > 10 ? 10 : 6);
    // shoe
    const sc = L.shoes, sole = shade(sc, 0.35);
    const sh = (z: number, rx: number, ry: number, yc: number, col: RGB): Ring => ({ c: [x, yc, z], u: [rx, 0, 0], v: [0, ry, 0], col, w: [[FT, 1]], n: 3 });
    if (pf) g.box([x, pf / 2 + 0.004, 0.045], [0.05, pf / 2, 0.125], sole, [[FT, 1]]);
    g.tube([sh(-0.085, 0.03, 0.035, 0.05 + pf, sc), sh(-0.05, 0.046, 0.052, 0.055 + pf, sc), sh(0.03, 0.05, 0.05, 0.052 + pf, sc), sh(0.11, 0.05, 0.036, 0.04 + pf, sc), sh(0.165, 0.036, 0.024, 0.03 + pf, sc)], seg > 10 ? 8 : 5);
  }

  // ---------- Torso ----------
  const layered = L.top === "jacket" || L.top === "blazer" || L.top === "coat";
  const ts = L.top === "tee" ? 1.04 : L.top === "long" ? 1.06 : L.top === "hoodie" ? 1.14 : 1.1;
  const openW = L.top === "blazer" ? 0.2 : 0.3;
  const topFn = layered
    ? (t: number): RGB => { const d = Math.abs(t - FRONT); return L.tie && d < 0.075 ? L.tie : d < openW ? L.innerCol : L.topCol; }
    : L.topCol;
  const hem = L.top === "hoodie" ? 0.92 : layered ? 0.9 : 0.97;
  const angles: number[] = [];
  { // radial samples with crisp edges at the jacket opening / tie
    const cuts = layered ? [FRONT - openW, FRONT - openW + 0.004, FRONT + openW - 0.004, FRONT + openW, ...(L.tie ? [FRONT - 0.075, FRONT - 0.071, FRONT + 0.071, FRONT + 0.075] : [])] : [];
    const n = seg + 2;
    for (let i = 0; i < n; i++) { const t = (i / n) * TAU; if (!cuts.some((c) => Math.abs(c - t) < 0.09)) angles.push(t); }
    angles.push(...cuts); angles.sort((a, b) => a - b);
  }
  const bust = f ? 0.014 : 0;
  const tdef: [number, number, number, number, W][] = [
    [0.84, 0.1, 0.08, 0, [[B.HIPS, 1]]], [0.9, hw * 0.95, 0.098, 0, [[B.HIPS, 1]]], [0.97, hw, 0.105, 0, [[B.HIPS, 1]]],
    [1.06, waist, 0.09, 0, [[B.HIPS, 0.5], [B.SPINE, 0.5]]], [1.17, (waist + chest) / 2, 0.098, bust * 0.4, [[B.SPINE, 0.6], [B.CHEST, 0.4]]],
    [1.29, chest, 0.106 + bust, bust * 0.7, [[B.CHEST, 1]]], [1.37, sw * 0.98, 0.096, 0, [[B.CHEST, 1]]], [1.41, sw * 0.8, 0.088, -0.002, [[B.CHEST, 1]]],
    [1.43, 0.1, 0.074, -0.004, [[B.CHEST, 0.7], [B.NECK, 0.3]]], [1.455, 0.05, 0.053, 0, [[B.NECK, 1]]], [1.53, 0.046, 0.05, 0.004, [[B.NECK, 0.5], [B.HEAD, 0.5]]],
  ];
  const collar = L.top === "hoodie" || layered ? 1.455 : 1.43;
  const tcol = (y: number): Ring["col"] => (y < hem ? (skirt ? L.bottomCol : L.bottomCol) : y < collar ? topFn : L.skin);
  g.tube(tdef.map(([y, rx, rz, zo, w]) => {
    const s = y >= hem && y < collar ? ts : y < hem ? 1.03 : 1;
    return ring([0, y, zo], rx * s, rz * s * bw, tcol(y), w);
  }), seg, true, true, angles);

  // jacket / coat tail and skirt shells (open at the bottom, follow the thighs)
  const shell = (y0: number, y1: number, r0x: number, r0z: number, r1x: number, r1z: number, col: Ring["col"], steps = 4) => {
    const rs: Ring[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, y = y0 + (y1 - y0) * t, k = Math.min(0.55, t * 0.75);
      const w = (a: number): W => { const c = Math.cos(a); const l = Math.max(0, -c), rr = Math.max(0, c); return [[B.HIPS, 1 - k * (l + rr)], [B.THIGH_L, k * l], [B.THIGH_R, k * rr]]; };
      rs.push(ring([0, y, 0], r0x + (r1x - r0x) * t, r0z + (r1z - r0z) * t, col, i === 0 ? [[B.HIPS, 1]] : w));
    }
    g.tube(rs, seg, false, false, typeof col === "function" ? angles : undefined);
  };
  if (L.bottom === "skirt") shell(1.03, 0.6, waist * 1.1, 0.1 * bw, hw * 1.42, 0.2 * bw, L.bottomCol);
  if (L.bottom === "longskirt") shell(1.03, 0.3, waist * 1.1, 0.1 * bw, hw * 1.5, 0.22 * bw, L.bottomCol, 6);
  if (L.top === "blazer" || L.top === "jacket") shell(1.0, 0.82, hw * 1.12, 0.118 * bw, hw * 1.16, 0.122 * bw, topFn, 2);
  if (L.top === "coat") shell(1.0, 0.5, hw * 1.13, 0.12 * bw, hw * 1.3, 0.16 * bw, topFn, 5);
  if (L.top === "hoodie") g.blob([0, 1.44, -0.085], [0.1, 0.07, 0.06], L.topCol, [[B.CHEST, 1]], 8, 4);
  if (L.scarf) g.tube([ring([0, 1.42, 0], 0.085, 0.08, L.scarf, [[B.NECK, 1]]), ring([0, 1.455, 0], 0.092, 0.088, L.scarf, [[B.NECK, 1]]), ring([0, 1.495, 0], 0.075, 0.072, L.scarf, [[B.NECK, 1]])], 10);

  // ---------- Arms ----------
  const sleeveEnd = L.top === "tee" ? 1.23 : 0.905;
  for (const s of [-1, 1]) {
    const o = s < 0 ? 0 : 3, AR = B.ARM_L + o, FO = B.FORE_L + o, HA = B.HAND_L + o;
    const adef: [number, number, number, W][] = [
      [1.415, 0.024, sw - 0.035, [[B.CHEST, 0.7], [AR, 0.3]]], [1.395, 0.04, sw - 0.002, [[B.CHEST, 0.35], [AR, 0.65]]], [1.345, 0.048, sw + 0.026, [[AR, 1]]], [1.26, 0.046, sw + 0.044, [[AR, 1]]],
      [1.23, 0.044, sw + 0.046, [[AR, 1]]], [1.17, 0.04, sw + 0.05, [[AR, 1]]], [1.13, 0.038, sw + 0.055, [[AR, 0.5], [FO, 0.5]]],
      [1.09, 0.039, sw + 0.057, [[FO, 1]]], [1.0, 0.035, sw + 0.061, [[FO, 1]]], [0.905, 0.027, sw + 0.065, [[FO, 1]]], [0.88, 0.024, sw + 0.066, [[HA, 1]]],
    ];
    g.tube(adef.map(([y, r, x, w]) => {
      const cl = y > sleeveEnd, k = (cl ? ts * (L.top === "tee" ? 1.06 : 1.02) : 1) * (0.9 + bw * 0.1) * (f ? 0.9 : 1);
      return ring([s * x, y, 0], r * k, r * k, cl ? L.topCol : L.skin, w);
    }), seg > 10 ? 9 : 5);
    const hx = s * (sw + 0.067);
    g.blob([hx, 0.825, 0.006], [0.019, 0.058, 0.035], L.skin, [[HA, 1]], 7, 4);
    g.blob([hx - s * 0.008, 0.845, 0.038], [0.011, 0.026, 0.012], L.skin, [[HA, 1]], 5, 3);
    if (L.briefcase && s > 0) g.box([hx, 0.66, 0.01], [0.035, 0.125, 0.19], hex("#2a2420"), [[HA, 1]]);
    if (L.phone && s > 0) g.box([hx - 0.025, 0.8, 0.03], [0.006, 0.07, 0.036], hex("#0d0e10"), [[HA, 1]]);
  }

  // ---------- Head ----------
  const HW: W = [[B.HEAD, 1]];
  const prof: [number, number, number, number][] = [
    [0.004, 0.026, 0.03, 0.04], [0.03, 0.054, 0.066, 0.02], [0.06, 0.068, 0.082, 0.008], [0.1, 0.075, 0.09, 0.003],
    [0.145, 0.077, 0.093, 0], [0.185, 0.072, 0.089, -0.002], [0.215, 0.058, 0.074, -0.004], [0.238, 0.034, 0.046, -0.005],
  ];
  const hy = (dy: number) => HY + dy * HS;
  g.tube(prof.map(([dy, rx, rz, zo]) => ring([0, hy(dy), zo * HS], rx * HS, rz * HS, L.skin, HW)), seg);
  const at = (x: number, dy: number, z: number): V3 => [x * HS, hy(dy), z * HS];
  const EW: W = [[B.EYES, 1]], MW: W = [[B.MOUTH, 1]];
  if (seg > 8) {
    const iris = hex("#3b2414"), white = hex("#f4f1ea");
    for (const s of [-1, 1]) {
      g.blob(at(s * 0.031, 0.115, 0.079), [0.019, 0.0145, 0.0065], white, EW, 8, 4);
      g.blob(at(s * 0.031, 0.1135, 0.0835), [0.0118, 0.0132, 0.005], iris, EW, 8, 4);
      g.blob(at(s * 0.0275, 0.1195, 0.088), [0.0036, 0.0036, 0.002], white, EW, 5, 3);
      g.blob(at(s * 0.032, 0.131, 0.082), [0.02, 0.0022, 0.005], shade(L.hair, 0.5), EW, 6, 3); // lash line
      g.blob(at(s * 0.033, 0.153, 0.083), [0.017, 0.003, 0.005], shade(L.hair, 0.8), HW, 6, 3); // brow
      g.blob(at(s * 0.079, 0.108, -0.004), [0.01, 0.023, 0.014], L.skin, HW, 6, 3); // ear
    }
    g.blob(at(0, 0.085, 0.094), [0.0085, 0.013, 0.011], mix(L.skin, hex("#c08060"), 0.12), HW, 6, 3);
    if (!L.mask) g.blob(at(0, 0.05, 0.0845), [0.017, 0.0042, 0.005], L.lip, MW, 8, 3);
    if (L.mask) g.tube([0.022, 0.045, 0.075, 0.098].map((dy, i) => {
      const p = prof[1 + Math.min(2, i)]; const k = 1.05;
      return { c: [0, hy(dy), (p[3] + 0.004) * HS] as V3, u: [p[1] * HS * k, 0, 0] as V3, v: [0, 0, p[2] * HS * k] as V3, col: hex("#eef0f2"), w: HW, a0: FRONT - 1.05, a1: FRONT + 1.05 };
    }), 8, false, false);
    if (L.sunglasses) {
      const dk = hex("#0c0d10");
      for (const s of [-1, 1]) g.blob(at(s * 0.032, 0.116, 0.089), [0.023, 0.015, 0.005], dk, HW, 8, 3, 3);
      g.blob(at(0, 0.122, 0.091), [0.012, 0.003, 0.003], dk, HW, 5, 3);
      for (const s of [-1, 1]) g.path([at(s * 0.054, 0.12, 0.078), at(s * 0.08, 0.118, 0.0)], [0.003], dk, HW, 4);
    }
    if (L.headphones) {
      const dk = hex("#1a1b1e");
      for (const s of [-1, 1]) g.blob(at(s * 0.086, 0.108, -0.004), [0.016, 0.034, 0.03], dk, HW, 8, 4);
      const band: V3[] = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * (i / 8); band.push(at(Math.cos(a) * 0.088, 0.11 + Math.sin(a) * 0.148, -0.006)); }
      g.path(band, [0.007], dk, HW, 5);
    }
  }

  // ---------- Hair ----------
  const hc = L.hair, hs = L.hairStyle;
  const cut = hs === "buzz" ? 1.035 : 1.085;
  const hairRing = (dy: number, gap: number, k = cut, zo = 0, w: W = HW, rxk = 1): Ring => {
    // interpolate the head profile at dy
    let i = 0; while (i < prof.length - 2 && prof[i + 1][0] < dy) i++;
    const a = prof[i], b = prof[i + 1], t = Math.max(0, Math.min(1, (dy - a[0]) / (b[0] - a[0])));
    const rx = (a[1] + (b[1] - a[1]) * t) * HS * k * rxk, rz = (a[2] + (b[2] - a[2]) * t) * HS * k, z = (a[3] + (b[3] - a[3]) * t) * HS + zo;
    return { c: [0, hy(dy), z], u: [rx, 0, 0], v: [0, 0, rz], col: hc, w, a0: FRONT + gap / 2, a1: FRONT + TAU - gap / 2 };
  };
  const hatted = L.hat !== "none";
  const fringe = hs === "bangs" || hs === "bob" || hs === "twin" || (hs === "long" && f);
  const rows: Ring[] = [{ c: [0, hy(0.243), -0.005], u: [0.012, 0, 0], v: [0, 0, 0.014], col: hc, w: HW, a0: FRONT + 0.001, a1: FRONT + TAU - 0.001 }];
  rows.push(hairRing(0.236, 0.002), hairRing(0.215, 0.002), hairRing(0.185, 0.002));
  if (fringe) rows.push(hairRing(0.158, 0.002, cut + 0.01), hairRing(0.14, 0.5, cut + 0.012), hairRing(0.139, 2.0));
  else rows.push(hairRing(0.168, 1.3), hairRing(0.15, 2.0));
  const low = hs === "buzz" ? 0.095 : hs === "short" || hs === "bangs" ? 0.07 : hs === "pony" || hs === "bun" || hs === "twin" ? 0.06 : 0.0;
  rows.push(hairRing(0.11, 2.2), hairRing(Math.max(low, 0.06), 2.5, cut + (low < 0.05 ? 0.03 : 0)));
  if (hs === "bob") rows.push(hairRing(0.02, 2.5, cut + 0.07), hairRing(-0.012, 2.6, cut + 0.05));
  if (hs === "long") {
    const cw: W = [[B.HEAD, 0.5], [B.CHEST, 0.5]], cw2: W = [[B.CHEST, 1]];
    rows.push(hairRing(0.02, 2.6, cut + 0.07), hairRing(-0.04, 3.0, cut + 0.5, -0.035, cw, 0.8), hairRing(-0.13, 3.3, cut + 0.75, -0.06, cw2, 0.72), hairRing(-0.22, 3.6, cut + 0.7, -0.07, cw2, 0.7), hairRing(-0.27, 3.8, cut + 0.5, -0.07, cw2, 0.7));
  }
  if (!(hatted && hs === "buzz")) g.tube(rows, seg, false, false);
  if (hs === "pony") g.path([at(0, 0.19, -0.088), at(0, 0.15, -0.145), at(0, 0.05, -0.16), at(0, -0.07, -0.14)], [0.03, 0.036, 0.03, 0.012], hc, (i) => (i > 1 ? [[B.HEAD, 0.6], [B.CHEST, 0.4]] : HW), 7);
  if (hs === "twin") for (const s of [-1, 1]) g.path([at(s * 0.078, 0.15, -0.03), at(s * 0.125, 0.1, -0.04), at(s * 0.14, -0.03, -0.03), at(s * 0.13, -0.16, -0.02)], [0.026, 0.036, 0.03, 0.01], hc, HW, 7);
  if (hs === "bun") g.blob(at(0, 0.235, -0.05), [0.042, 0.04, 0.042], hc, HW, 8, 5);

  // ---------- Hats ----------
  if (hatted) {
    const hk = cut + 0.035;
    const hat: Ring[] = [0.15, 0.185, 0.215, 0.238].map((dy) => ({ ...hairRing(dy, 0.002, hk), col: L.hatCol }));
    hat.push({ c: [0, hy(0.252), -0.005], u: [0.015, 0, 0], v: [0, 0, 0.018], col: L.hatCol, w: HW, a0: FRONT + 0.001, a1: FRONT + TAU - 0.001 });
    if (L.hat === "beanie") hat.unshift({ ...hairRing(0.125, 0.002, hk + 0.02), col: shade(L.hatCol, 0.8) });
    g.tube(hat, seg, false, false);
    if (L.hat === "cap") g.blob(at(0, 0.155, 0.125), [0.068, 0.007, 0.06], L.hatCol, HW, 8, 3);
    if (L.hat === "bucket") g.tube([{ ...hairRing(0.152, 0.002, hk), col: L.hatCol }, { ...hairRing(0.118, 0.002, hk + 0.42), col: L.hatCol }], seg, false, false);
  }

  // ---------- Bags & props ----------
  if (L.backpack) {
    const bc = L.backpack, cw: W = [[B.CHEST, 0.8], [B.SPINE, 0.2]];
    g.box([0, 1.2, -0.175 * bw], [0.125, 0.17, 0.068], bc, cw);
    g.box([0, 1.13, -0.25 * bw], [0.085, 0.07, 0.02], shade(bc, 0.75), cw);
    for (const s of [-1, 1]) g.path([[s * 0.1, 1.08, 0.1 * bw], [s * 0.105, 1.28, 0.118 * bw + bust], [s * 0.1, 1.41, 0.06], [s * 0.1, 1.42, -0.08]], [0.017], shade(bc, 0.7), cw, 5, 0.4);
  }
  if (L.tote) {
    const s = -1, tc = L.tote;
    g.box([s * (hw + 0.07), 0.93, 0], [0.045, 0.13, 0.15], tc, [[B.HIPS, 0.6], [B.SPINE, 0.4]]);
    g.path([[s * (hw + 0.07), 1.05, 0.05], [s * (sw + 0.02), 1.3, 0.04], [s * (sw - 0.02), 1.425, 0]], [0.009], shade(tc, 0.7), [[B.CHEST, 1]], 4);
    g.path([[s * (hw + 0.07), 1.05, -0.05], [s * (sw + 0.02), 1.3, -0.04], [s * (sw - 0.02), 1.425, 0]], [0.009], shade(tc, 0.7), [[B.CHEST, 1]], 4);
  }
  if (L.camera && L.arche !== "photographer") {
    const cw: W = [[B.CHEST, 1]], dk = hex("#141518");
    g.box([0, 1.16, 0.135 * bw + bust], [0.06, 0.04, 0.03], dk, cw);
    g.blob([0, 1.16, 0.175 * bw + bust], [0.03, 0.03, 0.03], hex("#26282c"), cw, 8, 4);
    for (const s of [-1, 1]) g.path([[s * 0.055, 1.19, 0.125 * bw], [s * 0.075, 1.34, 0.1 * bw + bust], [s * 0.06, 1.44, 0]], [0.006], dk, cw, 4);
  }
  return { geo: g, joints: J };
}

let uid = 0;
export function createCharacter(scene: Scene, look: Look, seg = 14): CharacterVisual {
  const id = ++uid;
  const { geo, joints } = buildGeo(look, seg);
  const skeleton = new Skeleton("sk" + id, "sk" + id, scene);
  const parents = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15, 4, 4];
  const names = ["hips", "spine", "chest", "neck", "head", "armL", "foreL", "handL", "armR", "foreR", "handR", "thighL", "shinL", "footL", "thighR", "shinR", "footR", "eyes", "mouth"];
  const bones: Bone[] = [];
  for (let i = 0; i < B.COUNT; i++) {
    const p = parents[i], j = joints[i], pj: V3 = p < 0 ? [0, 0, 0] : joints[p];
    bones.push(new Bone(names[i], skeleton, p < 0 ? null : bones[p], Matrix.Translation(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2])));
  }
  const mesh = geo.toMesh("char" + id, scene, true);
  mesh.skeleton = skeleton;
  mesh.numBoneInfluencers = 4;
  mesh.material = characterMaterial(scene);
  const scale = look.height / 1.74;
  mesh.scaling.setAll(scale);
  mesh.buildBoundingInfo(new Vector3(-0.9, -0.1, -0.9), new Vector3(0.9, 2.1, 0.9));
  mesh.receiveShadows = false;
  mesh.isPickable = false;
  const rest: V3[] = joints.map((j, i) => { const p = parents[i]; const pj: V3 = p < 0 ? [0, 0, 0] : joints[p]; return [j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]]; });
  return { mesh, skeleton, bones, rest, look, scale, dispose() { mesh.dispose(); skeleton.dispose(); } };
}
