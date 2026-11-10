// VehicleManager: cars, taxis, buses and delivery vans following lanes, obeying the IntersectionController.
import { Scene, Mesh, PBRMaterial, Color3, ShadowGenerator, MeshBuilder, StandardMaterial, TransformNode, BaseTexture } from "@babylonjs/core";
import { Geo, RGB, Ring, hex, shade } from "./characters/Geo";
import type { IntersectionController } from "./IntersectionController";
import { LANES, Lane, WORLD_END } from "./world/layout";

type Kind = "car" | "taxi" | "bus" | "van";
export interface Vehicle {
  kind: Kind; lane: Lane; laneIdx: number; s: number; v: number; vmax: number; len: number; wid: number;
  root: TransformNode; brake: number; x: number; z: number; id: number; lights: Mesh; body: Mesh;
}

const GLASS = hex("#141c24"), TYRE = hex("#111214"), HUB = hex("#9a9ca0");
const CAR_COLS = ["#e9e9e6", "#d0d2d4", "#1a1b1e", "#2b2e33", "#8b1f24", "#1f3a63", "#6f7378", "#3f5a48", "#c8c2b0", "#101114"].map(hex);
const VAN_COLS = ["#f0efe9", "#dcdcd6", "#2f6da8", "#e0b020"].map(hex);

function bodyGeo(kind: Kind, col: RGB): { g: Geo; len: number; wid: number } {
  const g = new Geo();
  const sec = (z: number, w: number, y0: number, y1: number, c: Ring["col"], n = 5): Ring => ({ c: [0, (y0 + y1) / 2, z], u: [w / 2, 0, 0], v: [0, (y1 - y0) / 2, 0], col: c, n });
  let len = 4.4, wid = 1.75;
  const wheels = (zs: number[], r: number, w: number, hw: number) => {
    for (const z of zs) for (const s of [-1, 1]) {
      const x = s * (hw - w / 2 + 0.02);
      g.tube([{ c: [x - s * w / 2, r, z], u: [0, r, 0], v: [0, 0, r], col: TYRE }, { c: [x + s * w / 2, r, z], u: [0, r, 0], v: [0, 0, r], col: TYRE }], 12);
      g.tube([{ c: [x + s * (w / 2 + 0.004), r, z], u: [0, r * 0.58, 0], v: [0, 0, r * 0.58], col: HUB }, { c: [x + s * (w / 2 + 0.012), r, z], u: [0, r * 0.5, 0], v: [0, 0, r * 0.5], col: HUB }], 10);
    }
  };
  if (kind === "car" || kind === "taxi") {
    len = 4.5; wid = 1.76;
    const h = len / 2;
    // lower body
    g.tube([sec(-h, wid * 0.82, 0.42, 0.78, col), sec(-h + 0.12, wid * 0.97, 0.3, 0.86, col), sec(-h + 0.9, wid, 0.24, 0.9, col), sec(0.5, wid, 0.24, 0.88, col), sec(h - 0.7, wid * 0.99, 0.26, 0.8, col), sec(h - 0.1, wid * 0.94, 0.3, 0.72, col), sec(h, wid * 0.78, 0.4, 0.66, col)], 16);
    // cabin: glass sides, painted roof
    const cab = (t: number): RGB => (Math.sin(t) > 0.72 ? col : GLASS);
    g.tube([sec(-h + 0.55, wid * 0.8, 0.8, 0.9, cab, 3.2), sec(-h + 1.05, wid * 0.86, 0.8, 1.4, cab, 3.2), sec(0.35, wid * 0.87, 0.8, 1.43, cab, 3.2), sec(1.05, wid * 0.82, 0.8, 0.95, cab, 3.2)], 16);
    wheels([-h + 0.85, h - 0.9], 0.31, 0.21, wid / 2);
    if (kind === "taxi") g.box([0, 1.5, -0.1], [0.16, 0.06, 0.07], hex("#f4e9b0"));
  } else if (kind === "van") {
    len = 4.7; wid = 1.72;
    const h = len / 2;
    const side = (t: number): RGB => { const s = Math.sin(t); return s > 0.12 && s < 0.74 && Math.abs(Math.cos(t)) > 0.1 ? GLASS : col; };
    g.tube([sec(-h, wid * 0.9, 0.34, 1.7, col, 6), sec(-h + 0.15, wid, 0.28, 1.86, col, 6), sec(0.6, wid, 0.28, 1.88, col, 6), sec(0.62, wid, 0.28, 1.88, side, 6), sec(h - 0.85, wid, 0.28, 1.84, side, 6), sec(h - 0.25, wid * 0.97, 0.3, 1.25, side, 5), sec(h, wid * 0.85, 0.4, 0.8, col, 5)], 20);
    wheels([-h + 0.9, h - 0.95], 0.32, 0.21, wid / 2);
  } else {
    len = 10.4; wid = 2.45;
    const h = len / 2, stripe = shade(col, 0.6);
    const side = (t: number): RGB => { const s = Math.sin(t), c = Math.abs(Math.cos(t)); return s > 0.86 ? hex("#e8e8e4") : s > 0.02 && s < 0.62 && c > 0.1 ? GLASS : s <= 0.02 && s > -0.3 ? stripe : col; };
    g.tube([sec(-h, wid * 0.94, 0.5, 2.9, col, 7), sec(-h + 0.12, wid, 0.36, 3.05, side, 7), sec(h - 0.14, wid, 0.36, 3.05, side, 7), sec(h, wid * 0.95, 0.5, 2.9, col, 7)], 28);
    g.box([0, 1.9, h + 0.005], [wid * 0.42, 0.62, 0.02], GLASS);
    g.box([0, 2.78, h + 0.01], [wid * 0.3, 0.12, 0.02], hex("#f0a030"));
    wheels([-h + 2.2, h - 1.9], 0.47, 0.28, wid / 2);
  }
  return { g, len, wid };
}

export class VehicleManager {
  list: Vehicle[] = [];
  private nextId = 1;
  private spawnT: number[] = LANES.map(() => Math.random() * 4);
  private paint: PBRMaterial;
  private head: StandardMaterial; private tail: StandardMaterial; private tailBrake: StandardMaterial;
  maxPerLane = 3;
  night = false;

  constructor(private scene: Scene, private signal: IntersectionController, private shadows: () => ShadowGenerator | null) {
    this.paint = new PBRMaterial("vehiclePaint", scene);
    this.paint.albedoColor = Color3.White(); this.paint.metallic = 0.35; this.paint.roughness = 0.32;
    this.paint.clearCoat.isEnabled = true; this.paint.clearCoat.intensity = 0.6; this.paint.clearCoat.roughness = 0.12;
    const em = (name: string, c: string, k: number) => { const m = new StandardMaterial(name, scene); m.disableLighting = true; m.emissiveColor = Color3.FromHexString(c).scale(k); return m; };
    this.head = em("vHead", "#fff3d6", 1.6); this.tail = em("vTail", "#a01010", 0.9); this.tailBrake = em("vBrake", "#ff2a1a", 2.2);
  }

  setReflection(tex: BaseTexture | null) { this.paint.reflectionTexture = tex; }

  private make(laneIdx: number, s: number): Vehicle {
    const r = Math.random();
    const kind: Kind = r < 0.54 ? "car" : r < 0.74 ? "taxi" : r < 0.9 ? "van" : "bus";
    const lane = LANES[laneIdx];
    const col = kind === "taxi" ? [hex("#16181d"), hex("#e3b21c"), hex("#2f7d4f"), hex("#f0efe9")][Math.floor(Math.random() * 4)]
      : kind === "bus" ? [hex("#e8e4d8"), hex("#2f6f4a"), hex("#b23a2e")][Math.floor(Math.random() * 3)]
      : kind === "van" ? VAN_COLS[Math.floor(Math.random() * VAN_COLS.length)] : CAR_COLS[Math.floor(Math.random() * CAR_COLS.length)];
    const { g, len, wid } = bodyGeo(kind, col);
    const id = this.nextId++;
    const root = new TransformNode("veh" + id, this.scene);
    const body = g.toMesh("vehBody" + id, this.scene);
    body.material = this.paint; body.parent = root; body.isPickable = false; body.receiveShadows = false;
    this.shadows()?.addShadowCaster(body);
    // lamps
    const h = len / 2, y = kind === "bus" ? 0.75 : 0.62, lw = kind === "bus" ? 0.34 : 0.3;
    const parts: Mesh[] = [];
    for (const sx of [-1, 1]) {
      const f = MeshBuilder.CreateBox("hl", { width: lw, height: 0.11, depth: 0.05 }, this.scene); f.position.set(sx * (wid / 2 - 0.32), y, h - 0.01); parts.push(f);
    }
    const lights = Mesh.MergeMeshes(parts, true)!; lights.material = this.head; lights.parent = root; lights.isPickable = false;
    const tparts: Mesh[] = [];
    for (const sx of [-1, 1]) { const t = MeshBuilder.CreateBox("tl", { width: lw, height: 0.12, depth: 0.05 }, this.scene); t.position.set(sx * (wid / 2 - 0.3), y + 0.08, -h + 0.01); tparts.push(t); }
    const tails = Mesh.MergeMeshes(tparts, true)!; tails.material = this.tail; tails.parent = root; tails.isPickable = false;
    root.rotation.y = lane.axis === "z" ? (lane.dir > 0 ? 0 : Math.PI) : lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    const v: Vehicle = { kind, lane, laneIdx, s, v: 0, vmax: (kind === "bus" ? 7.5 : 9.5) + Math.random() * 1.5, len, wid, root, brake: 0, x: 0, z: 0, id, lights: tails, body };
    this.place(v);
    this.list.push(v);
    return v;
  }

  private place(v: Vehicle) {
    const c = v.s * v.lane.dir;
    v.x = v.lane.axis === "z" ? v.lane.c : c; v.z = v.lane.axis === "z" ? c : v.lane.c;
    v.root.position.set(v.x, 0, v.z);
  }

  /** Initial traffic queued behind the stop lines. */
  seed() {
    LANES.forEach((_, i) => {
      let s = -24 - Math.random() * 10;
      for (let k = 0; k < 2; k++) { const v = this.make(i, s); v.v = 0; s -= v.len + 6 + Math.random() * 25; }
    });
  }

  vehiclesInJunction(): boolean {
    for (const v of this.list) if (v.s + v.len / 2 > v.lane.stop + 0.8 && v.s - v.len / 2 < -v.lane.stop) return true;
    return false;
  }

  /** Boxes used for player collision. */
  boxes(): { x0: number; x1: number; z0: number; z1: number }[] {
    return this.list.map((v) => {
      const hl = v.len / 2, hw = v.wid / 2;
      return v.lane.axis === "z" ? { x0: v.x - hw, x1: v.x + hw, z0: v.z - hl, z1: v.z + hl } : { x0: v.x - hl, x1: v.x + hl, z0: v.z - hw, z1: v.z + hw };
    });
  }

  update(dt: number, people: { x: number; z: number }[]) {
    // spawn
    for (let i = 0; i < LANES.length; i++) {
      this.spawnT[i] -= dt;
      if (this.spawnT[i] > 0) continue;
      const inLane = this.list.filter((v) => v.laneIdx === i);
      const last = inLane.reduce((m, v) => Math.min(m, v.s - v.len / 2), Infinity);
      if (inLane.length < this.maxPerLane && last > -WORLD_END + 16) { const v = this.make(i, -WORLD_END - 6); v.v = v.vmax * 0.8; }
      this.spawnT[i] = 3 + Math.random() * 9;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i], lane = v.lane, front = v.s + v.len / 2;
      let limit = v.vmax;
      const cap = (gap: number, a = 3.2) => { limit = Math.min(limit, Math.sqrt(Math.max(0, 2 * a * gap))); };
      // leader in the same lane
      for (const o of this.list) if (o !== v && o.laneIdx === v.laneIdx && o.s > v.s) cap(o.s - o.len / 2 - front - 2.2);
      // signal
      const lamp = this.signal.vehFor(lane.axis);
      const toStop = lane.stop - front;
      if (toStop > -0.6) {
        if (lamp === "red") cap(toStop - 0.4);
        else if (lamp === "yellow" && toStop > (v.v * v.v) / (2 * 3.6)) cap(toStop - 0.4);
      }
      // never drive into people: anyone ahead in (or stepping into) this lane
      for (const p of people) {
        const along = (lane.axis === "z" ? p.z : p.x) * lane.dir, lat = Math.abs((lane.axis === "z" ? p.x : p.z) - lane.c);
        const ahead = along - front;
        if (lat < v.wid / 2 + 1.1 && ahead > -1 && ahead < 22) cap(ahead - 2.2, 4.5);
      }
      const prev = v.v;
      if (limit < v.v) v.v = Math.max(limit, v.v - 6.5 * dt, 0); else v.v = Math.min(limit, v.v + 2.1 * dt);
      v.brake = prev - v.v > 0.4 * dt || v.v < 0.2 ? 1 : 0;
      v.s += v.v * dt;
      this.place(v);
      v.lights.material = v.brake ? this.tailBrake : this.tail;
      // gentle pitch under braking/acceleration
      v.root.rotation.x = ((v.v - prev) / Math.max(dt, 1e-3)) * 0.004;
      if (v.s > WORLD_END + 8) { this.shadows()?.removeShadowCaster(v.body); v.root.dispose(false, false); this.list.splice(i, 1); }
    }
  }

  dispose() { for (const v of this.list) v.root.dispose(); this.list.length = 0; }
}
