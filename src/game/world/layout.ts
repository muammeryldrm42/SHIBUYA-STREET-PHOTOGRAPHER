// Map geometry shared by every system: road/sidewalk regions, colliders, pedestrian network.
// Coordinates: +x east, +z north, origin at the centre of the scramble. Traffic keeps left.

export const ROAD_HX = 11; // half width of the north–south road
export const ROAD_HZ = 9; // half width of the east–west road
export const CURB_R = 3;
export const CURB_H = 0.15;
export const BLD_X = 19; // building line along the N–S road
export const BLD_Z = 17; // building line along the E–W road
export const PLAYER_LIMIT = 62;
export const WORLD_END = 125;

/** Signed distance to the curb: > 0 on a sidewalk, < 0 on the roadway. */
export function sidewalkDist(x: number, z: number): number {
  const ax = Math.abs(x) - ROAD_HX, az = Math.abs(z) - ROAD_HZ;
  if (ax <= 0 && az <= 0) return -Math.hypot(ax, az) - 0.01;
  if (ax <= 0) return ax;
  if (az <= 0) return az;
  if (ax < CURB_R && az < CURB_R) return CURB_R - Math.hypot(ax - CURB_R, az - CURB_R);
  return Math.min(ax, az);
}
export const onRoad = (x: number, z: number) => sidewalkDist(x, z) < 0;
export function groundY(x: number, z: number): number {
  const d = sidewalkDist(x, z);
  if (d <= -0.05) return 0;
  if (d >= 0.2) return CURB_H;
  return CURB_H * (d + 0.05) / 0.25;
}

/** Zone that must be empty of people before vehicles are released. */
export const inScrambleZone = (x: number, z: number) => Math.abs(x) < 18 && Math.abs(z) < 16 && onRoad(x, z);
export const inVehicleConflictZone = (x: number, z: number) => Math.abs(x) < 17.5 && Math.abs(z) < 15.5;

/** Nearest safe sidewalk point for someone standing on the roadway. */
export function nearestSidewalk(x: number, z: number): { x: number; z: number } {
  const sx = x >= 0 ? 1 : -1, sz = z >= 0 ? 1 : -1;
  const c: { x: number; z: number }[] = [];
  if (Math.abs(z) > ROAD_HZ + CURB_R) c.push({ x: sx * (ROAD_HX + 1.1), z });
  if (Math.abs(x) > ROAD_HX + CURB_R) c.push({ x, z: sz * (ROAD_HZ + 1.1) });
  for (const a of [-1, 1]) for (const b of [-1, 1]) c.push({ x: a * (ROAD_HX + 2), z: b * (ROAD_HZ + 2) });
  let best = c[0], bd = Infinity;
  for (const p of c) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
  return best;
}

// ---------- Static colliders ----------
export interface Box { x0: number; x1: number; z0: number; z1: number; h?: number }
export interface Circle { x: number; z: number; r: number }
export const colliders: { boxes: Box[]; circles: Circle[] } = { boxes: [], circles: [] };
export function addBox(x0: number, x1: number, z0: number, z1: number, h = 100) {
  colliders.boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), h });
}
export function addCircle(x: number, z: number, r: number) { colliders.circles.push({ x, z, r }); }

/** Push a circle (x,z,r) out of static colliders. Returns corrected position. */
export function resolveStatic(p: { x: number; z: number }, r: number) {
  for (const b of colliders.boxes) {
    const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1));
    let dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
    else {
      // centre is inside the box: leave through the nearest face
      const l = p.x - b.x0, rr = b.x1 - p.x, n = p.z - b.z0, f = b.z1 - p.z;
      const m = Math.min(l, rr, n, f);
      if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === n) p.z = b.z0 - r; else p.z = b.z1 + r;
    }
  }
  for (const c of colliders.circles) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = r + c.r;
    if (d < m && d > 1e-5) { p.x = c.x + (dx / d) * m; p.z = c.z + (dz / d) * m; }
  }
}

/** Distance along a ray until it hits a static box (for the third-person camera). */
export function rayBoxes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  let best = max;
  for (const b of colliders.boxes) {
    let t0 = 0, t1 = best;
    const sl = [[ox, dx, b.x0, b.x1], [oz, dz, b.z0, b.z1], [oy, dy, 0, b.h ?? 100]];
    let hit = true;
    for (const [o, d, mn, mx] of sl) {
      if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) { hit = false; break; } continue; }
      let a = (mn - o) / d, c = (mx - o) / d;
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit && t0 < best) best = t0;
  }
  return best;
}

// ---------- Pedestrian network ----------
export type CornerId = "NW" | "NE" | "SE" | "SW";
export const CORNERS: Record<CornerId, { sx: number; sz: number }> = {
  NW: { sx: -1, sz: 1 }, NE: { sx: 1, sz: 1 }, SE: { sx: 1, sz: -1 }, SW: { sx: -1, sz: -1 },
};
export const hub = (c: CornerId) => ({ x: CORNERS[c].sx * 15, z: CORNERS[c].sz * 13 });

export interface Arm { id: string; corner: CornerId; pts: { x: number; z: number }[]; weight: number; door?: boolean }
/** Sidewalk arms, listed from the corner hub outward to the spawn/despawn end. */
export const ARMS: Arm[] = [
  { id: "N_W", corner: "NW", weight: 1.2, pts: [{ x: -15, z: 19 }, { x: -15, z: WORLD_END }] },
  { id: "W_N", corner: "NW", weight: 1.0, pts: [{ x: -21, z: 13 }, { x: -WORLD_END, z: 13 }] },
  { id: "CG", corner: "NW", weight: 1.6, pts: [{ x: -30, z: 13 }, { x: -41, z: 14 }, { x: -41, z: 22 }, { x: -41, z: 100 }] },
  { id: "N_E", corner: "NE", weight: 1.2, pts: [{ x: 15, z: 19 }, { x: 15, z: WORLD_END }] },
  { id: "E_N", corner: "NE", weight: 0.8, pts: [{ x: 21, z: 13 }, { x: WORLD_END, z: 13 }] },
  { id: "S_E", corner: "SE", weight: 0.9, pts: [{ x: 15, z: -19 }, { x: 15, z: -WORLD_END }] },
  { id: "E_S", corner: "SE", weight: 0.7, pts: [{ x: 21, z: -13 }, { x: WORLD_END, z: -13 }] },
  { id: "ST", corner: "SE", weight: 2.2, door: true, pts: [{ x: 22, z: -19 }, { x: 37, z: -27 }, { x: 44.5, z: -27 }, { x: 50, z: -27 }] },
  { id: "S_W", corner: "SW", weight: 1.0, pts: [{ x: -15, z: -19 }, { x: -15, z: -WORLD_END }] },
  { id: "W_S", corner: "SW", weight: 1.0, pts: [{ x: -21, z: -13 }, { x: -WORLD_END, z: -13 }] },
];

export interface Crossing { a: { x: number; z: number }; b: { x: number; z: number }; diagonal: boolean }
/** Geometry of a crossing between two corners; u in [0,1] spreads people across the zebra width. */
export function crossingLine(from: CornerId, to: CornerId, u: number): Crossing {
  const A = CORNERS[from], B = CORNERS[to];
  if (A.sx !== B.sx && A.sz !== B.sz) {
    const ax = A.sx * 12.6, az = A.sz * 10.6, bx = B.sx * 12.6, bz = B.sz * 10.6;
    const len = Math.hypot(bx - ax, bz - az), px = -(bz - az) / len, pz = (bx - ax) / len, o = (u - 0.5) * 4.4;
    return { a: { x: ax + px * o, z: az + pz * o }, b: { x: bx + px * o, z: bz + pz * o }, diagonal: true };
  }
  if (A.sx !== B.sx) {
    const z = A.sz * (ROAD_HZ + 1.7 + u * 3.9);
    return { a: { x: A.sx * (ROAD_HX + 0.9), z }, b: { x: B.sx * (ROAD_HX + 0.9), z }, diagonal: false };
  }
  const x = A.sx * (ROAD_HX + 1.7 + u * 3.9);
  return { a: { x, z: A.sz * (ROAD_HZ + 0.9) }, b: { x, z: B.sz * (ROAD_HZ + 0.9) }, diagonal: false };
}

export const LOITER_SPOTS = [
  { x: 27, z: -33 }, { x: 31.5, z: -31 }, { x: 33.5, z: -37 }, { x: 26.5, z: -39 }, { x: 22, z: -27 },
  { x: 36, z: -20 }, { x: 20, z: -38 }, { x: 30, z: -43 }, { x: -22, z: 14.5 }, { x: 24, z: 14.5 }, { x: -23, z: -14.5 },
];

// ---------- Vehicle lanes ----------
export interface Lane { axis: "x" | "z"; dir: 1 | -1; c: number; stop: number }
/** s = dir * coordinate along travel; stop is the s value of the stop line. */
export const LANES: Lane[] = [
  { axis: "z", dir: 1, c: -2.5, stop: -17.6 }, { axis: "z", dir: 1, c: -7.2, stop: -17.6 },
  { axis: "z", dir: -1, c: 2.5, stop: -17.6 }, { axis: "z", dir: -1, c: 7.2, stop: -17.6 },
  { axis: "x", dir: 1, c: 2.3, stop: -19.6 }, { axis: "x", dir: 1, c: 6.3, stop: -19.6 },
  { axis: "x", dir: -1, c: -2.3, stop: -19.6 }, { axis: "x", dir: -1, c: -6.3, stop: -19.6 },
];

// ---------- Small helpers ----------
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
