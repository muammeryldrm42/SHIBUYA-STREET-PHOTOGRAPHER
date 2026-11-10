// WorldManager: builds the Shibuya scramble map and owns lighting, time of day and weather.
import {
  Scene, Mesh, MeshBuilder, PBRMaterial, StandardMaterial, Color3, Color4, Vector3, HemisphericLight, DirectionalLight,
  ShadowGenerator, ReflectionProbe, RenderTargetTexture, ParticleSystem, Texture, BaseTexture, AbstractMesh,
} from "@babylonjs/core";
import { Batch } from "./Batch";
import { Geo, hex, shade } from "../characters/Geo";
import * as T from "./textures";
import type { Rect } from "./textures";
import { ROAD_HX, ROAD_HZ, CURB_R, CURB_H, addBox, addCircle, colliders, mulberry, CORNERS, CornerId, crossingLine } from "./layout";
import type { IntersectionController } from "../IntersectionController";
import type { TimeOfDay, Weather } from "../../state/settings";

type C3 = [number, number, number];
const lin = (h: string): C3 => hex(h);
const EXT = 135;

interface TimePreset { sunDir: C3; sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; skyTop: string; skyMid: string; skyHor: string; fog: string; fogD: number; ev: number; exposure: number; emissive: number; windows: number; lamps: boolean; shadow: number }
const TIMES: Record<TimeOfDay, TimePreset> = {
  morning: { sunDir: [0.55, -0.62, 0.3], sun: "#ffe9c8", sunI: 3.4, hemiSky: "#cfe0f5", hemiGround: "#7d7468", hemiI: 0.95, skyTop: "#4f8fd8", skyMid: "#a9cdf0", skyHor: "#e6eef5", fog: "#cfdcea", fogD: 0.0024, ev: 14, exposure: 1.0, emissive: 0.75, windows: 0.05, lamps: false, shadow: 0.35 },
  afternoon: { sunDir: [-0.35, -0.82, -0.3], sun: "#fff6e6", sunI: 4.2, hemiSky: "#d6e6fa", hemiGround: "#857c70", hemiI: 1.0, skyTop: "#3f86dc", skyMid: "#9cc7f2", skyHor: "#dfeaf5", fog: "#cddbea", fogD: 0.002, ev: 15, exposure: 1.0, emissive: 0.7, windows: 0.0, lamps: false, shadow: 0.3 },
  golden: { sunDir: [-0.78, -0.27, -0.2], sun: "#ffad62", sunI: 3.6, hemiSky: "#b9b6dc", hemiGround: "#8a6a55", hemiI: 0.7, skyTop: "#3b5fa6", skyMid: "#f0a878", skyHor: "#ffcf9a", fog: "#e6b594", fogD: 0.0032, ev: 12.5, exposure: 1.05, emissive: 1.1, windows: 0.55, lamps: true, shadow: 0.25 },
  night: { sunDir: [-0.3, -0.75, 0.45], sun: "#9db2ff", sunI: 0.55, hemiSky: "#7482c8", hemiGround: "#5a4262", hemiI: 0.9, skyTop: "#05070f", skyMid: "#141a34", skyHor: "#3a2c4e", fog: "#1d1a33", fogD: 0.0042, ev: 7.5, exposure: 1.5, emissive: 2.3, windows: 1.5, lamps: true, shadow: 0.55 },
};

export class WorldManager {
  sun!: DirectionalLight; hemi!: HemisphericLight;
  shadow: ShadowGenerator | null = null;
  probe: ReflectionProbe | null = null;
  light = { ev: 15, baseExposure: 1 };
  train = { x: 51, z: 0, on: false };
  wet = false; night = false;
  private mats: Record<string, PBRMaterial> = {};
  private fac: { mat: PBRMaterial; batch: Batch }[] = [];
  private B: Record<string, Batch> = {};
  private lampMats: Record<string, PBRMaterial> = {};
  private lampCols: Record<string, Color3> = {};
  private screens: T.AdScreen[] = [];
  private screenMats: PBRMaterial[] = [];
  private screenBatches: Batch[] = [];
  private atlas!: T.SignAtlas;
  private sky!: { tex: ReturnType<typeof T.skyTex>; mesh: Mesh };
  private rain: ParticleSystem | null = null;
  private trains: { mesh: Mesh; t: number; dir: number; wait: number }[] = [];
  private staticMeshes: Mesh[] = [];
  private puddles!: Texture;
  private r = mulberry(20261109);
  private time: TimeOfDay = "afternoon"; private weather: Weather = "sunny";
  private streetGlow!: StandardMaterial;
  private black!: StandardMaterial;

  constructor(private scene: Scene) {}

  private pbr(name: string, o: { tex?: BaseTexture; color?: string; rough: number; metal?: number; em?: BaseTexture }): PBRMaterial {
    const m = new PBRMaterial(name, this.scene);
    if (o.tex) m.albedoTexture = o.tex;
    m.albedoColor = o.color ? Color3.FromHexString(o.color).toLinearSpace() : Color3.White();
    m.roughness = o.rough; m.metallic = o.metal ?? 0;
    if (o.em) { m.emissiveTexture = o.em; m.emissiveColor = Color3.White(); m.emissiveIntensity = 0; }
    m.environmentIntensity = 0.7;
    this.mats[name] = m;
    return m;
  }

  /** Unlit material whose colour is emissiveTexture x emissiveColor (StandardMaterial would add them). */
  private glowMat(name: string, tex: BaseTexture): PBRMaterial {
    const m = new PBRMaterial(name, this.scene);
    m.albedoColor = Color3.Black(); m.metallic = 0; m.roughness = 1; m.disableLighting = true; m.environmentIntensity = 0;
    m.emissiveTexture = tex; m.emissiveColor = Color3.White(); m.emissiveIntensity = 1;
    return m;
  }

  /** Builds the whole map. Reports real progress between stages. */
  async build(progress: (f: number, label: string) => void) {
    const s = this.scene, tick = () => new Promise<void>((r) => setTimeout(r, 0));
    progress(0.02, "Surfaces"); await tick();
    this.atlas = T.signAtlas(s);
    this.puddles = T.puddleTex(s);
    const asphalt = this.pbr("asphalt", { tex: T.asphaltTex(s), rough: 0.93 });
    const paver = this.pbr("paver", { tex: T.paverTex(s), rough: 0.86 });
    const plaza = this.pbr("plaza", { tex: T.paverTex(s, true), rough: 0.8 });
    const paint = this.pbr("paint", { rough: 0.6 }); paint.zOffset = -2;
    const props = this.pbr("props", { rough: 0.7 });
    const signs = this.pbr("signs", { tex: this.atlas.tex, rough: 0.5, em: this.atlas.tex });
    const shop = this.pbr("shop", { tex: T.shopfrontTex(s), rough: 0.25, em: (null as unknown as BaseTexture) });
    shop.emissiveTexture = shop.albedoTexture; shop.emissiveColor = Color3.White();
    for (let i = 0; i < 5; i++) {
      const f = T.facadeTex(s, i);
      const m = this.pbr("facade" + i, { tex: f.albedo, rough: i === 0 ? 0.18 : i === 3 ? 0.45 : 0.8, em: f.emissive });
      this.fac.push({ mat: m, batch: new Batch() });
    }
    for (const k of ["asphalt", "paver", "plaza", "paint", "props", "signs", "shop", "black", "glow"]) this.B[k] = new Batch();
    this.black = new StandardMaterial("black", s); this.black.disableLighting = true; this.black.emissiveColor = new Color3(0.012, 0.012, 0.014);
    this.streetGlow = new StandardMaterial("streetGlow", s); this.streetGlow.disableLighting = true; this.streetGlow.emissiveColor = Color3.Black();

    this.buildGround();
    progress(0.12, "Road markings"); await tick();
    this.buildMarkings();
    progress(0.2, "Landmarks"); await tick();
    for (let i = 0; i < 3; i++) {
      this.screens.push(new T.AdScreen(s, i));
      const m = this.glowMat("screen" + i, this.screens[i].tex);
      this.screenMats.push(m); this.screenBatches.push(new Batch());
    }
    this.buildHeroes();
    progress(0.34, "City blocks"); await tick();
    this.buildBlocks();
    progress(0.5, "Station and railway"); await tick();
    this.buildStation();
    progress(0.58, "Street furniture"); await tick();
    this.buildProps();
    this.buildSignals();
    progress(0.68, "Finalising geometry"); await tick();

    const add = (m: Mesh) => { this.staticMeshes.push(m); return m; };
    add(this.B.asphalt.build("ground", s, asphalt, { shadows: true }));
    add(this.B.paver.build("sidewalks", s, paver, { shadows: true }));
    add(this.B.plaza.build("plaza", s, plaza, { shadows: true }));
    add(this.B.paint.build("markings", s, paint, { shadows: true }));
    add(this.B.props.build("props", s, props, { shadows: true }));
    add(this.B.signs.build("signs", s, signs));
    add(this.B.shop.build("shopfronts", s, shop, { shadows: true }));
    add(this.B.black.build("darkInteriors", s, this.black));
    add(this.B.glow.build("lampHeads", s, this.streetGlow));
    this.fac.forEach((f, i) => { if (!f.batch.empty) add(f.batch.build("buildings" + i, s, f.mat, { shadows: true })); });
    this.screenBatches.forEach((b, i) => { if (!b.empty) add(b.build("screen" + i, s, this.screenMats[i])); });
    for (const k in this.lampB) add(this.lampB[k].build("lamp_" + k, s, this.lampMats[k]));
    progress(0.76, "Lighting"); await tick();
    this.buildSkyAndLights();
    this.buildTrains(props);
    this.buildRain();
    try {
      this.probe = new ReflectionProbe("cityProbe", 128, s, true);
      this.probe.position = new Vector3(0, 2.5, 0);
      this.probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      const skip = new Set(["ground", "sidewalks", "plaza", "markings", "buildings0"]);
      for (const m of this.staticMeshes) if (!skip.has(m.name)) this.probe.renderList!.push(m);
      this.probe.renderList!.push(this.sky.mesh);
      this.fac[0].mat.reflectionTexture = this.probe.cubeTexture;
    } catch (e) { console.warn("Reflection probe unavailable", e); this.probe = null; }
    progress(0.8, "World ready");
  }

  get reflection(): BaseTexture | null { return this.probe?.cubeTexture ?? null; }

  // ---------- ground ----------
  private buildGround() {
    this.B.asphalt.quad([-EXT, 0, -EXT], [EXT, 0, -EXT], [EXT, 0, EXT], [-EXT, 0, EXT], [0, 1, 0], [-EXT / 5, -EXT / 5, EXT / 5, EXT / 5]);
    const P = this.B.paver, curb = lin("#9a9892");
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // outline: fillet arc, then the outer rectangle (convex → fan triangulation)
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) { const a = Math.PI + (Math.PI / 2) * (i / 8); pts.push([ROAD_HX + CURB_R + Math.cos(a) * CURB_R, ROAD_HZ + CURB_R + Math.sin(a) * CURB_R]); }
      pts.push([EXT, ROAD_HZ], [EXT, EXT], [ROAD_HX, EXT]);
      const w = (p: [number, number]): [number, number, number] => [p[0] * sx, CURB_H, p[1] * sz];
      const uv = (p: [number, number]): [number, number] => [(p[0] * sx) / 2.4, (p[1] * sz) / 2.4];
      const c: [number, number] = [EXT, EXT];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (a === c || b === c) continue;
        const ua = uv(a), ub = uv(b), uc = uv(c);
        // degenerate quad = triangle; custom UVs need per-corner values, so use small rect approximations
        P.quad(w(a), w(b), w(c), w(c), [0, 1, 0], [Math.min(ua[0], ub[0], uc[0]), Math.min(ua[1], ub[1], uc[1]), Math.max(ua[0], ub[0], uc[0]), Math.max(ua[1], ub[1], uc[1])]);
      }
      // curb faces along the road edges
      const edge = [...pts.slice(0, 10), [ROAD_HX, EXT] as [number, number]];
      const ring = [[ROAD_HX, EXT] as [number, number], ...pts.slice(0, 10)];
      void edge;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const nx = -(b[1] - a[1]) * sz, nz = (b[0] - a[0]) * sx, l = Math.hypot(nx, nz) || 1;
        // normal must point toward the road (away from the sidewalk interior)
        const mx = ((a[0] + b[0]) / 2) * sx, mz = ((a[1] + b[1]) / 2) * sz;
        const sgn = (mx * nx + mz * nz) < 0 ? 1 : -1;
        this.B.props.quad([a[0] * sx, 0, a[1] * sz], [b[0] * sx, 0, b[1] * sz], [b[0] * sx, CURB_H, b[1] * sz], [a[0] * sx, CURB_H, a[1] * sz], [(nx / l) * sgn, 0, (nz / l) * sgn], [0, 0, 1, 1], curb);
      }
    }
    // The fan above cannot carry a continuous tiling, so lay proper world-mapped tiles on top.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x0 = sx > 0 ? ROAD_HX + CURB_R : -EXT, x1 = sx > 0 ? EXT : -ROAD_HX - CURB_R, z0 = sz > 0 ? ROAD_HZ : -EXT, z1 = sz > 0 ? EXT : -ROAD_HZ;
      P.quad([x0, CURB_H + 0.004, z0], [x1, CURB_H + 0.004, z0], [x1, CURB_H + 0.004, z1], [x0, CURB_H + 0.004, z1], [0, 1, 0], [x0 / 2.4, z0 / 2.4, x1 / 2.4, z1 / 2.4]);
      const xa = sx > 0 ? ROAD_HX : -ROAD_HX - CURB_R, xb = sx > 0 ? ROAD_HX + CURB_R : -ROAD_HX, za = sz > 0 ? ROAD_HZ + CURB_R : -EXT, zb = sz > 0 ? EXT : -ROAD_HZ - CURB_R;
      P.quad([xa, CURB_H + 0.004, za], [xb, CURB_H + 0.004, za], [xb, CURB_H + 0.004, zb], [xa, CURB_H + 0.004, zb], [0, 1, 0], [xa / 2.4, za / 2.4, xb / 2.4, zb / 2.4]);
    }
    // Hachiko plaza paving
    this.B.plaza.quad([19, CURB_H + 0.012, -48], [44, CURB_H + 0.012, -48], [44, CURB_H + 0.012, -17], [19, CURB_H + 0.012, -17], [0, 1, 0], [19 / 4, -48 / 4, 44 / 4, -17 / 4]);
  }

  private buildMarkings() {
    const M = this.B.paint, white = lin("#e8e8e4"), yellow = lin("#d9a520"), tact = lin("#e2b21a");
    const y = 0.012;
    // zebra crossings: rungs perpendicular to the walking direction
    for (const sz of [-1, 1]) for (let x = -10.4; x <= 10.41; x += 0.95) M.ground(x, sz * 12.6, 2.4, 0.24, 0, y, white);
    for (const sx of [-1, 1]) for (let z = -8.4; z <= 8.41; z += 0.95) M.ground(sx * 14.6, z, 2.4, 0.24, Math.PI / 2, y, white);
    for (const s of [1, -1]) {
      const ax = -12.6, az = 10.6 * s, bx = 12.6, bz = -10.6 * s, len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(bx - ax, bz - az);
      for (let d = 5.2; d < len - 5.1; d += 0.95) { const t = d / len; M.ground(ax + (bx - ax) * t, az + (bz - az) * t, 0.24, 2.3, ang, y, white); }
    }
    // stop lines, lane lines, centre lines
    for (const sz of [-1, 1]) {
      M.ground(sz < 0 ? -5.5 : 5.5, sz * 17.3, 0.22, 5.4, 0, y, white);
      for (let z = 20; z < EXT; z += 6) for (const x of [-4.9, 4.9]) M.ground(x, sz * z, 1.5, 0.07, 0, y, white);
      M.ground(0, sz * ((18 + EXT) / 2), (EXT - 18) / 2, 0.09, 0, y, yellow);
    }
    for (const sx of [-1, 1]) {
      M.ground(sx * 19.3, sx < 0 ? 4.5 : -4.5, 4.4, 0.22, 0, y, white);
      for (let x = 22; x < EXT; x += 6) for (const z of [-4.3, 4.3]) M.ground(sx * x, z, 0.07, 1.5, 0, y, white);
      M.ground(sx * ((20 + EXT) / 2), 0, 0.09, (EXT - 20) / 2, 0, y, yellow);
    }
    // tactile paving at every crossing end
    const ty = CURB_H + 0.02;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      M.ground(sx * (ROAD_HX + 0.75), sz * 12.9, 2.1, 0.22, 0, ty, tact);
      M.ground(sx * 14.9, sz * (ROAD_HZ + 0.75), 0.22, 2.1, 0, ty, tact);
    }
  }

  // ---------- buildings ----------
  private signIdx = 0; private vertIdx = 0; private billIdx = 0;
  private nextH(): Rect { return this.atlas.horiz[this.signIdx++ % 16]; }
  private nextV(): Rect { return this.atlas.vert[this.vertIdx++ % this.atlas.vert.length]; }
  private nextB(): Rect { return this.atlas.bill[this.billIdx++ % this.atlas.bill.length]; }

  /** One building with shopfront, sign band, facade, parapet, rooftop clutter, blade signs and billboards. */
  private building(b: { x0: number; x1: number; z0: number; z1: number; h: number; style: number; tint?: C3; fronts: string; blades?: number; roofSign?: boolean; wallAd?: boolean; noCollide?: boolean }) {
    const r = this.r, { x0, x1, z0, z1, h } = b, tint = b.tint ?? [1, 1, 1];
    const F = this.fac[b.style].batch, PR = this.B.props, S = this.B.signs;
    const rest = "NSEW".split("").filter((c) => !b.fronts.includes(c)).join("");
    const g0 = CURB_H, g1 = 4.25, s1 = 5.35;
    this.B.shop.box(x0, x1, g0, g1, z0, z1, { tile: 12, tileV: 4.1, sides: b.fronts, top: false });
    if (rest) F.box(x0, x1, g0, g1, z0, z1, { tile: 12, sides: rest, top: false, col: tint });
    const band = shade(lin("#2a2c30"), 0.8 + r() * 0.6);
    PR.box(x0 - 0.22, x1 + 0.22, g1, s1, z0 - 0.22, z1 + 0.22, { col: band, rect: [0, 0, 0.01, 0.01], bottom: true });
    F.box(x0, x1, s1, h, z0, z1, { tile: 12, col: tint, top: false });
    PR.box(x0 - 0.12, x1 + 0.12, h, h + 0.9, z0 - 0.12, z1 + 0.12, { col: lin("#4a4b4e"), rect: [0, 0, 0.01, 0.01] });
    for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
      const w = 1.5 + r() * 2.5, d = 1.5 + r() * 2.5, cx = x0 + 1.5 + r() * Math.max(0.1, x1 - x0 - 3 - w), cz = z0 + 1.5 + r() * Math.max(0.1, z1 - z0 - 3 - d);
      PR.box(cx, cx + w, h + 0.9, h + 1.9 + r() * 1.6, cz, cz + d, { col: shade(lin("#8d8f92"), 0.6 + r() * 0.5), rect: [0, 0, 0.01, 0.01] });
    }
    const side = (c: string) => {
      const horizontal = c === "N" || c === "S";
      const len = horizontal ? x1 - x0 : z1 - z0, nx = c === "E" ? 1 : c === "W" ? -1 : 0, nz = c === "N" ? 1 : c === "S" ? -1 : 0;
      const at = (t: number, off: number): [number, number] => horizontal ? [x0 + len * t, (c === "N" ? z1 : z0) + nz * off] : [(c === "E" ? x1 : x0) + nx * off, z0 + len * t];
      return { len, nx, nz, at };
    };
    for (const c of b.fronts) {
      const { len, nx, nz, at } = side(c);
      // shop signs along the band
      const n = Math.max(1, Math.round(len / 7.5));
      for (let i = 0; i < n; i++) { const [px, pz] = at((i + 0.5) / n, 0.25); const w = Math.min(5.6, len / n - 0.6); S.panel(px, (g1 + s1) / 2, pz, nx, nz, w, 0.95, this.nextH()); }
      // blade signs
      const blades = b.blades ?? (len > 8 ? 1 + Math.floor(r() * 2.4) : 1);
      for (let i = 0; i < blades; i++) {
        const t = (i + 0.3 + r() * 0.4) / blades, [px, pz] = at(t, 0.62), cy = Math.min(h - 3, 8.5 + r() * Math.max(0, Math.min(h - 13, 12))), hh = 2.2, hw = 0.55;
        const tx = -nz, tz = nx; // along the wall
        PR.box(px - Math.abs(nx) * hw - Math.abs(tx) * 0.11, px + Math.abs(nx) * hw + Math.abs(tx) * 0.11, cy - hh, cy + hh, pz - Math.abs(nz) * hw - Math.abs(tz) * 0.11, pz + Math.abs(nz) * hw + Math.abs(tz) * 0.11, { col: lin("#1c1d20"), rect: [0, 0, 0.01, 0.01], bottom: true });
        const uv = this.nextV();
        S.panel(px + tx * 0.125, cy, pz + tz * 0.125, tx, tz, hw * 2 - 0.08, hh * 2 - 0.1, uv);
        S.panel(px - tx * 0.125, cy, pz - tz * 0.125, -tx, -tz, hw * 2 - 0.08, hh * 2 - 0.1, uv);
      }
      // large wall advert
      if ((b.wallAd ?? r() < 0.45) && len > 11 && h > 24) {
        const w = Math.min(len - 3, 8 + r() * 3), hh2 = w * 0.75, [px, pz] = at(0.5, 0.16), cy = Math.min(h - hh2 / 2 - 1.5, 13 + r() * (h - 24) * 0.5);
        PR.box(px - (nz ? w / 2 + 0.2 : 0.1), px + (nz ? w / 2 + 0.2 : 0.1), cy - hh2 / 2 - 0.2, cy + hh2 / 2 + 0.2, pz - (nx ? w / 2 + 0.2 : 0.1), pz + (nx ? w / 2 + 0.2 : 0.1), { col: lin("#151618"), rect: [0, 0, 0.01, 0.01], bottom: true });
        S.panel(px + nx * 0.12, cy, pz + nz * 0.12, nx, nz, w, hh2, this.nextB());
      }
    }
    if (b.roofSign ?? r() < 0.35) {
      const { len, nx, nz, at } = side(b.fronts[0]);
      const w = Math.min(len * 0.8, 11), hh = w * 0.75, [px, pz] = at(0.5, -1), cy = h + 2.4 + hh / 2;
      for (const o of [-w / 2 + 0.3, w / 2 - 0.3]) { const fx = px + (nz ? o : 0), fz = pz + (nx ? o : 0); PR.box(fx - 0.1, fx + 0.1, h + 0.9, cy - hh / 2, fz - 0.1, fz + 0.1, { col: lin("#303236"), rect: [0, 0, 0.01, 0.01] }); }
      PR.box(px - (nz ? w / 2 : 0.12), px + (nz ? w / 2 : 0.12), cy - hh / 2, cy + hh / 2, pz - (nx ? w / 2 : 0.12), pz + (nx ? w / 2 : 0.12), { col: lin("#17181a"), rect: [0, 0, 0.01, 0.01], bottom: true });
      S.panel(px + nx * 0.14, cy, pz + nz * 0.14, nx, nz, w - 0.3, hh - 0.3, this.nextB());
    }
    if (!b.noCollide) addBox(x0, x1, z0, z1);
  }

  private tint(): C3 { const r = this.r, k = 0.72 + r() * 0.5; return [k * (0.94 + r() * 0.12), k * (0.94 + r() * 0.1), k * (0.92 + r() * 0.14)]; }

  /** Row of buildings along one axis between `from` and `to`. */
  private row(axis: "x" | "z", from: number, to: number, a0: number, a1: number, fronts: string, hMin = 22, hMax = 46) {
    const r = this.r;
    let p = from;
    while (p < to - 6) {
      let w = 9 + r() * 8;
      if (to - (p + w) < 8) w = to - p;
      const h = hMin + r() * (hMax - hMin), style = Math.floor(r() * 5);
      const o = { h, style, tint: this.tint(), fronts };
      if (axis === "x") this.building({ x0: p, x1: p + w - 0.25, z0: a0, z1: a1, ...o }); else this.building({ x0: a0, x1: a1, z0: p, z1: p + w - 0.25, ...o });
      p += w;
    }
  }

  private screenPanel(i: number, cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number) {
    const PR = this.B.props;
    PR.box(cx - (nz ? w / 2 + 0.3 : 0.15), cx + (nz ? w / 2 + 0.3 : 0.15), cy - h / 2 - 0.3, cy + h / 2 + 0.3, cz - (nx ? w / 2 + 0.3 : 0.15), cz + (nx ? w / 2 + 0.3 : 0.15), { col: lin("#0e0f11"), rect: [0, 0, 0.01, 0.01], bottom: true });
    this.screenBatches[i].panel(cx + nx * 0.17, cy, cz + nz * 0.17, nx, nz, w, h, [0, 0, 1, 1]);
  }

  private buildHeroes() {
    // NW: glass corner building with the giant "Kosaten Vision" screen (faces the scramble)
    this.building({ x0: -37, x1: -19, z0: 17, z1: 45, h: 46, style: 0, tint: [0.95, 1.05, 1.15], fronts: "SEW", blades: 0, roofSign: true, wallAd: false });
    this.screenPanel(0, -28, 17.5, 17, 0, -1, 15.5, 8.7);
    this.screenPanel(0, -19, 17.5, 28, 1, 0, 15.5, 8.7);
    this.B.signs.panel(-28, 28.2, 16.8, 0, -1, 12, 2.6, this.atlas.horiz[4]);
    // NE: dark panel tower wrapped in adverts
    this.building({ x0: 19, x1: 44, z0: 17, z1: 40, h: 40, style: 3, tint: [1.1, 1.1, 1.15], fronts: "SW", blades: 2, roofSign: true, wallAd: false });
    this.screenPanel(1, 19, 15, 28.5, -1, 0, 12.5, 7);
    this.screenPanel(1, 30, 15, 17, 0, -1, 12.5, 7);
    this.B.signs.panel(18.8, 26, 28.5, -1, 0, 12, 9, this.atlas.bill[4]);
    this.B.signs.panel(30, 26, 16.8, 0, -1, 12, 9, this.atlas.bill[2]);
    // SW: white building with stacked billboards
    this.building({ x0: -40, x1: -19, z0: -42, z1: -17, h: 34, style: 4, fronts: "NE", blades: 2, roofSign: true, wallAd: false });
    this.screenPanel(2, -29.5, 13.5, -17, 0, 1, 12, 6.75);
    this.B.signs.panel(-18.8, 12, -29, 1, 0, 9, 6.75, this.atlas.bill[0]);
    this.B.signs.panel(-18.8, 20.5, -29, 1, 0, 9, 6.75, this.atlas.bill[5]);
    this.B.signs.panel(-29.5, 22.5, -16.8, 0, 1, 12, 9, this.atlas.bill[7]);
    // West: cylindrical fashion tower at the fork (recognisable silhouette down the avenue)
    const F = this.fac[3].batch, cx = -77, cz = 28;
    this.fac[1].batch.cyl(cx, cz, CURB_H, 9, 11, 11, 28, { tile: 12, col: [0.9, 0.9, 0.95] });
    F.cyl(cx, cz, 9, 54, 9.6, 9.6, 28, { tile: 12, col: [2.4, 2.45, 2.6] });
    this.B.props.cyl(cx, cz, 54, 56, 10, 10, 28, { col: lin("#c9ccd2") });
    this.B.signs.panel(cx, 49, cz - 9.75, 0, -1, 8.5, 6.4, this.atlas.bill[4]);
    this.B.signs.panel(cx + 9.75, 49, cz, 1, 0, 8.5, 6.4, this.atlas.bill[4]);
    this.B.signs.panel(cx, 6.6, cz - 11.1, 0, -1, 9, 1.6, this.atlas.horiz[21]);
    addBox(cx - 11, cx + 11, cz - 11, cz + 11);
    // Center-Gai gate and banners
    const PR = this.B.props, red = lin("#b3161c");
    for (const x of [-44.6, -37.4]) { PR.cyl(x, 18, CURB_H, 6.4, 0.22, 0.22, 10, { col: red }); addCircle(x, 18, 0.25); }
    PR.box(-45, -37, 6.2, 7.6, 17.8, 18.2, { col: red, rect: [0, 0, 0.01, 0.01], bottom: true });
    this.B.signs.panel(-41, 6.9, 17.78, 0, -1, 6.6, 1.25, this.atlas.named.centerGai);
    this.B.signs.panel(-41, 6.9, 18.22, 0, 1, 6.6, 1.25, this.atlas.named.centerGai);
    for (let z = 26; z < 120; z += 9) {
      PR.box(-45, -37, 6.9, 6.96, z - 0.02, z + 0.02, { col: lin("#222"), rect: [0, 0, 0.01, 0.01] });
      for (const x of [-43.4, -41, -38.6]) { const uv = this.nextV(); this.B.signs.panel(x, 6.1, z - 0.03, 0, -1, 0.45, 1.6, uv); this.B.signs.panel(x, 6.1, z + 0.03, 0, 1, 0.45, 1.6, uv); }
    }
  }

  private buildBlocks() {
    this.row("z", 45.3, 130, -37, -19, "EW");
    this.row("z", 17, 130, -63, -45, "ES", 20, 38);
    this.row("x", -130, -88.5, 17, 37, "S");
    this.row("z", 40.3, 130, 19, 44, "W", 26, 52);
    this.row("x", 58.5, 130, 17, 37, "S");
    this.row("x", 58.5, 130, -37, -17, "N");
    this.building({ x0: 19, x1: 44, z0: -84, z1: -48.3, h: 44, style: 4, tint: [1.02, 1, 0.97], fronts: "WN", blades: 3, roofSign: true, wallAd: true });
    this.row("z", -130, -84.3, 19, 44, "W", 28, 50);
    this.row("z", -130, -42.3, -40, -19, "E");
    this.row("x", -130, -40.3, -37, -17, "N");
    // background towers for depth and skyline
    const far: [number, number, number, number, number, number][] = [
      [70, -80, 34, 34, 190, 0], [108, -44, 30, 40, 150, 0], [-75, -78, 30, 26, 110, 3], [-110, 70, 28, 30, 95, 4], [80, 80, 30, 30, 120, 0],
      [-20, 150, 40, 26, 100, 1], [40, 160, 30, 30, 130, 0], [-150, 20, 26, 40, 85, 2], [150, 30, 30, 30, 105, 3], [-60, -150, 36, 28, 120, 0],
      [20, -160, 30, 30, 90, 4], [-95, 95, 24, 24, 70, 2], [95, -110, 26, 30, 100, 1], [-100, -55, 22, 22, 64, 4], [72, 60, 22, 24, 72, 2], [-84, 64, 20, 22, 60, 3],
    ];
    for (const [x, z, w, d, h, st] of far) this.fac[st].batch.box(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, { tile: 12, col: st === 0 ? [1.1, 1.2, 1.35] : this.tint(), top: true, topRect: [0, 0, 0.01, 0.01] });
  }

  private buildStation() {
    const F = this.fac[2].batch, PR = this.B.props, K = this.B.black, conc = lin("#8f8c86"), steel = lin("#4d5257");
    const tint: C3 = [0.95, 0.93, 0.9];
    // viaduct base: north part, south part (with the Hachiko entrance gap at z -30.5..-23.5)
    const base = (z0: number, z1: number, shopW: boolean) => {
      if (shopW) { this.B.shop.box(44, 58, CURB_H, 4.25, z0, z1, { tile: 12, tileV: 4.1, sides: "W", top: false }); F.box(44, 58, CURB_H, 4.25, z0, z1, { tile: 12, sides: "NSE", top: false, col: tint }); F.box(44, 58, 4.25, 5.7, z0, z1, { tile: 12, top: false, col: tint }); }
      else F.box(44, 58, CURB_H, 5.7, z0, z1, { tile: 12, top: false, col: tint });
      addBox(44, 58, z0, z1);
    };
    base(17, 130, false); base(-23.5, -17, true); base(-130, -30.5, true);
    addBox(51.5, 58, -30.5, -23.5);
    // dark entrance hall
    K.quad([51.5, 0, -30.5], [51.5, 0, -23.5], [51.5, 5.7, -23.5], [51.5, 5.7, -30.5], [-1, 0, 0]);
    K.quad([44, 4.4, -30.5], [51.5, 4.4, -30.5], [51.5, 4.4, -23.5], [44, 4.4, -23.5], [0, -1, 0]);
    K.quad([44, 0, -30.5], [51.5, 0, -30.5], [51.5, 5.7, -30.5], [44, 5.7, -30.5], [0, 0, 1]);
    K.quad([44, 0, -23.5], [51.5, 0, -23.5], [51.5, 5.7, -23.5], [44, 5.7, -23.5], [0, 0, -1]);
    this.B.glow.quad([44.4, 4.36, -30], [51, 4.36, -30], [51, 4.36, -24], [44.4, 4.36, -24], [0, -1, 0]);
    PR.box(40.2, 44.3, 4.5, 4.85, -32.5, -21.5, { col: lin("#d7d9dc"), rect: [0, 0, 0.01, 0.01], bottom: true });
    for (const z of [-32.2, -21.8]) { PR.cyl(40.5, z, CURB_H, 4.5, 0.12, 0.12, 8, { col: steel }); addCircle(40.5, z, 0.15); }
    this.B.signs.panel(43.8, 5.6, -27, -1, 0, 7.4, 1.45, this.atlas.named.station);
    this.B.signs.panel(40.15, 4.68, -27, -1, 0, 5.2, 0.3, this.atlas.named.street1);
    // deck, bridge over the avenue, parapets, catenary masts
    PR.box(43.4, 58.6, 5.7, 7.0, -EXT, EXT, { col: conc, rect: [0, 0, 0.01, 0.01], bottom: true });
    PR.box(43.2, 43.6, 7.0, 8.3, -EXT, EXT, { col: lin("#b9bcc0"), rect: [0, 0, 0.01, 0.01] });
    PR.box(58.4, 58.8, 7.0, 8.3, -EXT, EXT, { col: lin("#b9bcc0"), rect: [0, 0, 0.01, 0.01] });
    PR.box(43.3, 58.7, 4.9, 5.7, -17, 17, { col: lin("#3d6b54"), rect: [0, 0, 0.01, 0.01], bottom: true }); // green girder
    this.B.signs.panel(43.25, 5.3, 0, -1, 0, 9, 0.7, this.atlas.named.street1);
    this.B.signs.panel(58.75, 5.3, 0, 1, 0, 9, 0.7, this.atlas.named.street2);
    for (const x of [45, 57]) for (const z of [-9.9, 9.9]) { PR.box(x - 0.6, x + 0.6, 0, 4.9, z - 0.6, z + 0.6, { col: conc, rect: [0, 0, 0.01, 0.01] }); addCircle(x, z, 0.75); }
    for (let z = -120; z <= 120; z += 30) { for (const x of [43.9, 58.1]) PR.cyl(x, z, 7, 13, 0.12, 0.1, 6, { col: steel }); PR.box(43.9, 58.1, 12.6, 12.8, z - 0.08, z + 0.08, { col: steel, rect: [0, 0, 0.01, 0.01], bottom: true }); }
  }

  private lampB: Record<string, Batch> = {};
  private buildSignals() {
    const s = this.scene, PR = this.B.props, lens = T.lampTex(s), dk = lin("#16171a"), pole = lin("#8a8f94");
    const mk = (key: string, col: string, tex: Texture) => {
      const m = this.glowMat("lamp_" + key, tex);
      this.lampMats[key] = m; this.lampCols[key] = Color3.FromHexString(col).toLinearSpace(); this.lampB[key] = new Batch();
    };
    mk("nsG", "#2dffb0", lens); mk("nsY", "#ffc21a", lens); mk("nsR", "#ff2a1a", lens);
    mk("ewG", "#2dffb0", lens); mk("ewY", "#ffc21a", lens); mk("ewR", "#ff2a1a", lens);
    mk("pedR", "#ff3020", T.pedIconTex(s, false)); mk("pedG", "#30ffa8", T.pedIconTex(s, true));
    // vehicle heads: far side of the junction, over the approach lanes, facing oncoming traffic
    for (const [dx, dz, ax] of [[0, 1, "ns"], [0, -1, "ns"], [1, 0, "ew"], [-1, 0, "ew"]] as [number, number, string][]) {
      const lx = -dz, lz = dx; // left of travel
      const far = dx ? 18.4 : 16.4, half = dx ? ROAD_HZ : ROAD_HX;
      const hx = dx * far + lx * (half * 0.45), hz = dz * far + lz * (half * 0.45);
      const px = dx * far + lx * (half + 0.9), pz = dz * far + lz * (half + 0.9);
      PR.cyl(px, pz, CURB_H, 6.6, 0.16, 0.12, 10, { col: pole }); addCircle(px, pz, 0.2);
      PR.box(Math.min(px, hx) - 0.07, Math.max(px, hx) + 0.07, 6.15, 6.3, Math.min(pz, hz) - 0.07, Math.max(pz, hz) + 0.07, { col: pole, rect: [0, 0, 0.01, 0.01], bottom: true });
      const rx = dz, rz = -dx; // viewer's right when looking along travel
      PR.box(hx - Math.abs(rx) * 0.82 - Math.abs(dx) * 0.16, hx + Math.abs(rx) * 0.82 + Math.abs(dx) * 0.16, 5.55, 6.15, hz - Math.abs(rz) * 0.82 - Math.abs(dz) * 0.16, hz + Math.abs(rz) * 0.82 + Math.abs(dz) * 0.16, { col: dk, rect: [0, 0, 0.01, 0.01], bottom: true });
      (["G", "Y", "R"] as const).forEach((c, i) => {
        const o = (i - 1) * 0.5;
        this.lampB[ax + c].panel(hx + rx * o - dx * 0.17, 5.85, hz + rz * o - dz * 0.17, -dx, -dz, 0.42, 0.42, [0, 0, 1, 1]);
      });
      // street name plate on the mast
      this.B.signs.panel(px + rx * 1.2 - dx * 0.1, 5.2, pz + rz * 1.2 - dz * 0.1, -dx, -dz, 2.2, 0.55, dx ? this.atlas.named.street2 : this.atlas.named.street1);
    }
    // pedestrian heads: one at the far end of every crossing direction
    const ids = Object.keys(CORNERS) as CornerId[];
    for (const from of ids) for (const to of ids) {
      if (from === to) continue;
      const L = crossingLine(from, to, 0.5), len = Math.hypot(L.b.x - L.a.x, L.b.z - L.a.z), dx = (L.b.x - L.a.x) / len, dz = (L.b.z - L.a.z) / len;
      const side = L.diagonal ? 0 : 2.9; // side crossings: post beside the zebra, not in the walking line
      const px = L.b.x + dx * 0.9 + -dz * side, pz = L.b.z + dz * 0.9 + dx * side;
      PR.cyl(px, pz, CURB_H, 3.5, 0.075, 0.075, 8, { col: pole }); addCircle(px, pz, 0.12);
      PR.box(px - 0.24, px + 0.24, 2.55, 3.5, pz - 0.24, pz + 0.24, { col: dk, rect: [0, 0, 0.01, 0.01], bottom: true });
      const ox = -dx * 0.26, oz = -dz * 0.26;
      this.lampB.pedR.panel(px + ox, 3.24, pz + oz, -dx, -dz, 0.36, 0.36, [0, 0, 1, 1]);
      this.lampB.pedG.panel(px + ox, 2.82, pz + oz, -dx, -dz, 0.36, 0.36, [0, 0, 1, 1]);
    }
  }

  /** Push the controller's state into the lamp materials (called every frame; cheap). */
  applySignals(c: IntersectionController, t: number) {
    const set = (k: string, on: boolean) => { const m = this.lampMats[k]; if (m) m.emissiveColor.copyFrom(this.lampCols[k]).scaleInPlace(on ? 2.4 : 0.05); };
    const ns = c.vehNS, ew = c.vehEW, ped = c.ped;
    set("nsG", ns === "green"); set("nsY", ns === "yellow"); set("nsR", ns === "red");
    set("ewG", ew === "green"); set("ewY", ew === "yellow"); set("ewR", ew === "red");
    set("pedR", ped === "red"); set("pedG", ped === "green" || (ped === "flash" && Math.floor(t * 4) % 2 === 0));
  }

  // ---------- props ----------
  private buildProps() {
    const PR = this.B.props, r = this.r, rail = lin("#dfe1e3"), steel = lin("#6a6f75"), dark = lin("#2a2c30");
    // guardrails along the curbs (leave the crossings open)
    const railX = (x: number, z0: number, z1: number) => {
      for (let z = z0; z <= z1 + 0.01; z += 2) PR.cyl(x, z, CURB_H, 1.05, 0.035, 0.035, 6, { col: rail });
      for (const y of [0.55, 0.98]) PR.box(x - 0.03, x + 0.03, y, y + 0.06, z0, z1, { col: rail, rect: [0, 0, 0.01, 0.01], bottom: true });
      addBox(x - 0.08, x + 0.08, z0, z1, 1.1);
    };
    const railZ = (z: number, x0: number, x1: number) => {
      for (let x = x0; x <= x1 + 0.01; x += 2) PR.cyl(x, z, CURB_H, 1.05, 0.035, 0.035, 6, { col: rail });
      for (const y of [0.55, 0.98]) PR.box(x0, x1, y, y + 0.06, z - 0.03, z + 0.03, { col: rail, rect: [0, 0, 0.01, 0.01], bottom: true });
      addBox(x0, x1, z - 0.08, z + 0.08, 1.1);
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      railX(sx * (ROAD_HX + 0.4), sz > 0 ? 18 : -70, sz > 0 ? 70 : -18);
      if (!(sx > 0)) railZ(sz * (ROAD_HZ + 0.4), -70, -20); else { railZ(sz * (ROAD_HZ + 0.4), 20, 43); railZ(sz * (ROAD_HZ + 0.4), 59, 70); }
    }
    // street lamps
    const lamp = (x: number, z: number, ox: number, oz: number) => {
      PR.cyl(x, z, CURB_H, 7.4, 0.11, 0.07, 8, { col: steel }); addCircle(x, z, 0.14);
      const hx = x + ox * 1.6, hz = z + oz * 1.6;
      PR.box(Math.min(x, hx) - 0.05, Math.max(x, hx) + 0.05, 7.3, 7.4, Math.min(z, hz) - 0.05, Math.max(z, hz) + 0.05, { col: steel, rect: [0, 0, 0.01, 0.01], bottom: true });
      PR.box(hx - 0.3, hx + 0.3, 7.18, 7.32, hz - 0.3, hz + 0.3, { col: dark, rect: [0, 0, 0.01, 0.01] });
      this.B.glow.quad([hx - 0.26, 7.17, hz - 0.26], [hx + 0.26, 7.17, hz - 0.26], [hx + 0.26, 7.17, hz + 0.26], [hx - 0.26, 7.17, hz + 0.26], [0, -1, 0]);
    };
    for (const s of [-1, 1]) for (let d = 26; d <= 114; d += 22) { lamp(s * 11.9, d, -s, 0); lamp(s * 11.9, -d, -s, 0); lamp(-d, s * 9.9, 0, -s); if (d > 60 || d < 40) lamp(d, s * 9.9, 0, -s); }
    for (const [x, z] of [[24, -22], [36, -44], [22, -44], [38, -22]]) lamp(x, z, 0, 0.01);
    // vending machines, bins, bollards, utility boxes
    const vend = (x: number, z: number, nx: number, nz: number) => {
      const w = nz ? 1.0 : 0.75, d = nz ? 0.75 : 1.0;
      PR.box(x - w / 2, x + w / 2, CURB_H, 2.0, z - d / 2, z + d / 2, { col: lin("#e8e8e6"), rect: [0, 0, 0.01, 0.01] });
      this.B.signs.panel(x + nx * (w / 2 + 0.01), 1.08, z + nz * (d / 2 + 0.01), nx, nz, 0.92, 1.8, this.atlas.vend[Math.floor(r() * 2)]);
      addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 2);
    };
    vend(-18.55, 24, 1, 0); vend(-18.55, 25.1, 1, 0); vend(18.55, -52, -1, 0); vend(-24, -16.55, 0, 1); vend(-25.1, -16.55, 0, 1); vend(26, 16.55, 0, -1); vend(-44.55, 40, 1, 0); vend(43.5, -40, -1, 0);
    const bin = (x: number, z: number) => { PR.cyl(x, z, CURB_H, 1.0, 0.27, 0.27, 10, { col: lin("#3b4a44") }); PR.cyl(x, z, 1.0, 1.06, 0.3, 0.3, 10, { col: dark }); addCircle(x, z, 0.3); };
    bin(18.2, -20.5); bin(-18.2, 20.5); bin(18.3, 21); bin(-18.3, -21); bin(30.5, -47.2); bin(-38, 22); bin(42, -18.5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const a of [0.12, 0.88]) {
      // bollards beside (not in) the crossing mouths
      const ang = Math.PI + (Math.PI / 2) * a, bx = sx * (ROAD_HX + CURB_R + Math.cos(ang) * (CURB_R - 0.45)), bz = sz * (ROAD_HZ + CURB_R + Math.sin(ang) * (CURB_R - 0.45));
      void bx; void bz;
    }
    for (const [x, z] of [[-18.3, 30], [18.3, 34], [-30, -16.4], [30, 16.4], [-18.3, -46]]) { PR.box(x - 0.35, x + 0.35, CURB_H, 1.45, z - 0.25, z + 0.25, { col: lin("#9aa0a4"), rect: [0, 0, 0.01, 0.01] }); addBox(x - 0.35, x + 0.35, z - 0.25, z + 0.25, 1.5); }
    // subway entrance at the south end of the plaza
    {
      const x0 = 38.4, x1 = 42.6, z0 = -47.7, z1 = -44.6, wall = lin("#c9ccd0");
      PR.box(x0, x1, CURB_H, 1.1, z1 - 0.2, z1, { col: wall, rect: [0, 0, 0.01, 0.01] }); PR.box(x0, x1, CURB_H, 1.1, z0, z0 + 0.2, { col: wall, rect: [0, 0, 0.01, 0.01] }); PR.box(x1 - 0.2, x1, CURB_H, 1.1, z0, z1, { col: wall, rect: [0, 0, 0.01, 0.01] });
      PR.box(x0 - 0.3, x1 + 0.3, 2.7, 2.95, z0 - 0.3, z1 + 0.3, { col: lin("#e4e6e8"), rect: [0, 0, 0.01, 0.01], bottom: true });
      for (const [x, z] of [[x0 + 0.1, z0 + 0.1], [x0 + 0.1, z1 - 0.1], [x1 - 0.1, z0 + 0.1], [x1 - 0.1, z1 - 0.1]]) PR.cyl(x, z, CURB_H, 2.7, 0.07, 0.07, 6, { col: steel });
      this.B.black.quad([x0, CURB_H + 0.03, z0 + 0.2], [x1 - 0.2, CURB_H + 0.03, z0 + 0.2], [x1 - 0.2, CURB_H + 0.03, z1 - 0.2], [x0, CURB_H + 0.03, z1 - 0.2], [0, 1, 0]);
      this.B.signs.panel(x0 - 0.31, 2.83, (z0 + z1) / 2, -1, 0, 3.2, 0.24, this.atlas.named.subway);
      addBox(x0, x1, z0, z1);
    }
    // plaza: benches, planters, statue plinth
    const bench = (x: number, z: number, alongX: boolean) => {
      const w = alongX ? 1.0 : 0.25, d = alongX ? 0.25 : 1.0;
      PR.box(x - w, x + w, 0.55, 0.62, z - d, z + d, { col: lin("#7a5a3c"), rect: [0, 0, 0.01, 0.01], bottom: true });
      for (const o of [-0.8, 0.8]) PR.box(x + (alongX ? o : 0) - 0.05, x + (alongX ? o : 0) + 0.05, CURB_H, 0.55, z + (alongX ? 0 : o) - 0.05, z + (alongX ? 0 : o) + 0.05, { col: dark, rect: [0, 0, 0.01, 0.01] });
      addBox(x - w, x + w, z - d, z + d, 0.7);
    };
    bench(24, -41, true); bench(35.5, -41, true); bench(21.5, -32, false); bench(39.5, -36, false);
    PR.box(28.9, 30.5, CURB_H, 1.25, -36.8, -35.2, { col: lin("#8b8780"), rect: [0, 0, 0.01, 0.01] });
    PR.box(28.6, 30.8, CURB_H, 0.45, -37.1, -34.9, { col: lin("#77736c"), rect: [0, 0, 0.01, 0.01] });
    addCircle(29.7, -36, 1.5);
    this.buildOrganic();
  }

  /** Trees and the dog statue (lofted geometry, not boxes). */
  private buildOrganic() {
    const s = this.scene, r = this.r;
    const g = new Geo();
    const tree = (x: number, z: number, h: number) => {
      const bark = shade(hex("#5a4636"), 0.8 + r() * 0.4);
      g.tube([0, 0.5, 1.6, h * 0.55, h * 0.7].map((y, i) => ({ c: [x + (i > 2 ? (r() - 0.5) * 0.3 : 0), CURB_H + y, z + (i > 2 ? (r() - 0.5) * 0.3 : 0)], u: [0.26 - i * 0.04, 0, 0], v: [0, 0, 0.26 - i * 0.04], col: bark })), 8);
      PRbox(x, z);
      for (let i = 0; i < 6; i++) {
        const a = r() * 6.28, rr = i === 0 ? 0 : 0.9 + r() * 1.3, gy = h * (0.62 + r() * 0.3), sz = 1.2 + r() * 1.1;
        const col = shade(hex(["#3f6a36", "#4c7a3c", "#35592e", "#5a8444"][Math.floor(r() * 4)]), 0.8 + r() * 0.4);
        const from = g.count;
        g.blob([x + Math.cos(a) * rr, CURB_H + gy, z + Math.sin(a) * rr], [sz, sz * 0.72, sz], col, undefined, 9, 6);
        const cx = x + Math.cos(a) * rr, cz = z + Math.sin(a) * rr;
        g.transform(from, (p) => { const k = 1 + Math.sin(p[0] * 5.1 + p[1] * 3.7) * 0.09 + Math.sin(p[2] * 6.3 + p[1] * 2.1) * 0.08; return [cx + (p[0] - cx) * k, p[1], cz + (p[2] - cz) * k]; });
      }
      addCircle(x, z, 0.34);
    };
    const PRbox = (x: number, z: number) => this.B.props.box(x - 0.75, x + 0.75, CURB_H, CURB_H + 0.12, z - 0.75, z + 0.75, { col: [0.05, 0.04, 0.035], rect: [0, 0, 0.01, 0.01] });
    for (const [x, z] of [[23, -24.5], [33, -21.3], [39.5, -33.5], [24, -46], [34, -46.6], [20.5, -36]]) tree(x, z, 7.5 + r() * 2);
    for (let z = 30; z <= 120; z += 18) { tree(-12, z + 4, 7 + r() * 2.5); tree(12, z - 3, 7 + r() * 2.5); tree(12, -z - 34, 7 + r() * 2); tree(-12, -z - 30, 7 + r() * 2); }
    const trees = g.toMesh("trees", s);
    const tm = new PBRMaterial("foliage", s); tm.albedoColor = Color3.White(); tm.metallic = 0; tm.roughness = 0.95; tm.environmentIntensity = 0.4;
    trees.material = tm; trees.isPickable = false; trees.freezeWorldMatrix(); trees.receiveShadows = false;
    this.staticMeshes.push(trees);

    // loyal-dog statue: seated dog on the plinth
    const d = new Geo(), br = hex("#6a4a2a"), ox = 29.7, oy = 1.25, oz = -36;
    const ring = (y: number, z: number, rx: number, rz: number) => ({ c: [ox, oy + y, oz + z] as [number, number, number], u: [rx, 0, 0] as [number, number, number], v: [0, 0, rz] as [number, number, number], col: br });
    d.tube([ring(0, -0.05, 0.3, 0.34), ring(0.18, -0.06, 0.34, 0.38), ring(0.5, 0, 0.28, 0.3), ring(0.78, 0.06, 0.24, 0.24), ring(0.95, 0.1, 0.17, 0.17), ring(1.05, 0.12, 0.15, 0.15)], 12);
    d.blob([ox, oy + 1.18, oz + 0.16], [0.19, 0.18, 0.21], br, undefined, 10, 6);
    d.blob([ox, oy + 1.13, oz + 0.35], [0.1, 0.085, 0.13], br, undefined, 8, 5);
    for (const sx of [-1, 1]) {
      d.blob([ox + sx * 0.13, oy + 1.38, oz + 0.1], [0.055, 0.1, 0.04], br, undefined, 6, 4);
      d.path([[ox + sx * 0.15, oy + 0.72, oz + 0.2], [ox + sx * 0.16, oy + 0.35, oz + 0.3], [ox + sx * 0.16, oy + 0.04, oz + 0.3]], [0.075, 0.062, 0.06], br, undefined, 7);
      d.blob([ox + sx * 0.16, oy + 0.04, oz + 0.38], [0.07, 0.04, 0.1], br, undefined, 6, 4);
      d.blob([ox + sx * 0.3, oy + 0.14, oz + 0.02], [0.14, 0.14, 0.26], br, undefined, 8, 5);
    }
    d.path([[ox, oy + 0.1, oz - 0.36], [ox + 0.12, oy + 0.32, oz - 0.44], [ox + 0.16, oy + 0.5, oz - 0.34], [ox + 0.08, oy + 0.55, oz - 0.22]], [0.07, 0.075, 0.065, 0.04], br, undefined, 7);
    const dog = d.toMesh("hachikoStatue", s);
    dog.rotation.y = -2.3; dog.setPivotPoint(new Vector3(ox, 0, oz));
    const bm = new PBRMaterial("bronze", s); bm.albedoColor = Color3.White(); bm.metallic = 0.35; bm.roughness = 0.42; bm.environmentIntensity = 1;
    dog.material = bm; dog.isPickable = false;
    this.mats.bronze = bm;
    this.dynamicCasters.push(dog, trees);
  }
  private dynamicCasters: Mesh[] = [];

  // ---------- trains ----------
  private buildTrains(mat: PBRMaterial) {
    for (const [x, dir] of [[48.4, 1], [53.6, -1]] as [number, number][]) {
      const b = new Batch(), silver = lin("#c9cdd1"), green = lin("#7bbf3a"), glass = lin("#1a2530");
      for (let c = 0; c < 8; c++) {
        const z0 = c * 20.4 - 81.6, z1 = z0 + 19.8;
        b.box(-1.45, 1.45, 0.9, 1.75, z0, z1, { col: silver, rect: [0, 0, 0.01, 0.01], bottom: true });
        b.box(-1.46, 1.46, 1.75, 2.0, z0, z1, { col: green, rect: [0, 0, 0.01, 0.01], top: false });
        b.box(-1.44, 1.44, 2.0, 2.95, z0 + 0.5, z1 - 0.5, { col: glass, rect: [0, 0, 0.01, 0.01], top: false });
        b.box(-1.45, 1.45, 2.0, 2.95, z0, z0 + 0.5, { col: silver, rect: [0, 0, 0.01, 0.01], top: false }); b.box(-1.45, 1.45, 2.0, 2.95, z1 - 0.5, z1, { col: silver, rect: [0, 0, 0.01, 0.01], top: false });
        for (let k = 1; k < 4; k++) { const zz = z0 + (19.8 * k) / 4; b.box(-1.455, 1.455, 2.0, 2.95, zz - 0.7, zz + 0.7, { col: silver, rect: [0, 0, 0.01, 0.01], top: false }); }
        b.box(-1.45, 1.45, 2.95, 3.5, z0, z1, { col: silver, rect: [0, 0, 0.01, 0.01] });
        b.box(-1.1, 1.1, 0.35, 0.9, z0 + 1.5, z0 + 4.5, { col: lin("#2a2c30"), rect: [0, 0, 0.01, 0.01] }); b.box(-1.1, 1.1, 0.35, 0.9, z1 - 4.5, z1 - 1.5, { col: lin("#2a2c30"), rect: [0, 0, 0.01, 0.01] });
      }
      const built = b.build("train" + x, this.scene, mat); built.unfreezeWorldMatrix(); built.doNotSyncBoundingInfo = false; built.alwaysSelectAsActiveMesh = true;
      built.position.set(x, 7.0, -400 * dir);
      this.trains.push({ mesh: built, t: 0, dir, wait: dir > 0 ? 6 : 28 });
    }
  }

  // ---------- sky, lights, rain ----------
  private buildSkyAndLights() {
    const s = this.scene;
    const tex = T.skyTex(s);
    const mesh = MeshBuilder.CreateSphere("sky", { diameter: 1000, segments: 12, sideOrientation: Mesh.BACKSIDE }, s);
    const m = this.glowMat("skyMat", tex.tex); m.fogEnabled = false; m.backFaceCulling = true;
    mesh.material = m; mesh.infiniteDistance = true; mesh.isPickable = false; mesh.applyFog = false;
    this.sky = { tex, mesh };
    this.hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), s);
    this.sun = new DirectionalLight("sun", new Vector3(-0.3, -0.8, -0.3), s);
    this.sun.autoUpdateExtends = false; this.sun.orthoLeft = -58; this.sun.orthoRight = 58; this.sun.orthoTop = 58; this.sun.orthoBottom = -58;
    this.sun.shadowMinZ = 1; this.sun.shadowMaxZ = 520;
    s.fogMode = Scene.FOGMODE_EXP2;
  }

  setShadowQuality(level: 0 | 1 | 2 | 3, casters: AbstractMesh[]) {
    if (level === 0) { this.sun.shadowEnabled = false; return; }
    this.sun.shadowEnabled = true;
    const size = level === 1 ? 1024 : level === 2 ? 2048 : 4096;
    if (!this.shadow) {
      const sg = (this.shadow = new ShadowGenerator(size, this.sun));
      sg.usePercentageCloserFiltering = true; sg.bias = 0.0022; sg.normalBias = 0.03;
      for (const m of this.staticMeshes) if (/^(buildings|props|shopfronts|trees)/.test(m.name)) sg.addShadowCaster(m);
      for (const m of this.dynamicCasters) sg.addShadowCaster(m);
      for (const t of this.trains) sg.addShadowCaster(t.mesh);
      for (const m of casters) sg.addShadowCaster(m);
    } else if (this.shadow.mapSize !== size) this.shadow.mapSize = size;
    this.shadow.filteringQuality = level === 3 ? ShadowGenerator.QUALITY_HIGH : level === 2 ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
  }

  private buildRain() {
    const ps = new ParticleSystem("rain", 3500, this.scene);
    ps.particleTexture = T.rainTex(this.scene);
    ps.emitter = new Vector3(0, 14, 0);
    ps.minEmitBox = new Vector3(-20, 0, -20); ps.maxEmitBox = new Vector3(20, 2, 20);
    ps.direction1 = new Vector3(-1.2, -24, 0.4); ps.direction2 = new Vector3(-0.4, -28, 1);
    ps.minLifeTime = 0.5; ps.maxLifeTime = 0.62; ps.minSize = 0.28; ps.maxSize = 0.5; ps.minScaleX = 0.07; ps.maxScaleX = 0.1;
    ps.minEmitPower = 1; ps.maxEmitPower = 1; ps.gravity = Vector3.Zero();
    ps.color1 = new Color4(0.75, 0.8, 0.9, 0.5); ps.color2 = new Color4(0.7, 0.75, 0.85, 0.35); ps.colorDead = new Color4(0.7, 0.75, 0.85, 0.2);
    ps.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED; ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitRate = 0; ps.updateSpeed = 1 / 60;
    ps.start();
    this.rain = ps;
  }

  /** Apply time of day and weather. Everything here changes what the camera really sees. */
  setEnvironment(time: TimeOfDay, weather: Weather, effects: number) {
    this.time = time; this.weather = weather;
    const p = TIMES[time], s = this.scene;
    const cloudy = weather !== "sunny", rainy = weather === "rainy", night = time === "night";
    this.night = night; this.wet = rainy;
    const c = (h: string) => Color3.FromHexString(h).toLinearSpace();
    const grey = (h: string, k: number) => { const a = Color3.FromHexString(h); const l = (a.r + a.g + a.b) / 3 * (rainy ? 0.72 : 0.9); return Color3.Lerp(a, new Color3(l, l, l * 1.03), k).toHexString(); };
    const kSun = night ? (rainy ? 0.8 : 1) : rainy ? 0.1 : cloudy ? 0.22 : 1;
    this.sun.direction = new Vector3(...p.sunDir).normalize();
    this.sun.diffuse = c(cloudy && !night ? grey(p.sun, 0.8) : p.sun); this.sun.specular = this.sun.diffuse;
    this.sun.intensity = p.sunI * kSun;
    this.hemi.diffuse = c(cloudy ? grey(p.hemiSky, 0.7) : p.hemiSky); this.hemi.groundColor = c(p.hemiGround); this.hemi.specular = Color3.Black();
    this.hemi.intensity = p.hemiI * (night ? 1 : rainy ? 1.25 : cloudy ? 1.45 : 1);
    if (cloudy && !night) T.paintSky(this.sky.tex, grey(p.skyTop, 0.9), grey(p.skyMid, 0.92), grey(p.skyHor, 0.9));
    else if (cloudy) T.paintSky(this.sky.tex, "#0b0c12", "#1a1b26", "#322c3c");
    else T.paintSky(this.sky.tex, p.skyTop, p.skyMid, p.skyHor);
    const fog = Color3.FromHexString(cloudy && !night ? grey(p.fog, 0.85) : p.fog);
    s.fogColor = fog; s.fogDensity = p.fogD * (rainy ? 2.4 : cloudy ? 1.5 : 1);
    s.clearColor = new Color4(fog.r, fog.g, fog.b, 1);
    this.light = { ev: p.ev - (night ? (rainy ? 0.3 : 0) : rainy ? 2.5 : cloudy ? 1.5 : 0), baseExposure: p.exposure * (rainy && !night ? 1.08 : 1) };
    if (this.shadow) this.shadow.setDarkness(cloudy && !night ? 0.8 : p.shadow);
    // emissive surfaces
    const dim = cloudy && !night ? 1.25 : 1;
    this.mats.signs.emissiveIntensity = p.emissive * dim * 0.55;
    this.mats.shop.emissiveIntensity = (night ? 1.25 : time === "golden" ? 0.7 : 0.3) * dim;
    for (const f of this.fac) f.mat.emissiveIntensity = Math.min(1.6, p.windows + (cloudy && !night ? 0.25 : 0));
    for (const m of this.screenMats) m.emissiveIntensity = (night ? 1.9 : time === "golden" ? 1.5 : 1.15) * (effects === 0 ? 0.8 : 1);
    const lampsOn = p.lamps || rainy;
    this.streetGlow.emissiveColor = lampsOn ? new Color3(2.6, 2.2, 1.6) : new Color3(0.25, 0.25, 0.25);
    // wet surfaces: glossy, darker, reflecting the city
    const asphalt = this.mats.asphalt, paver = this.mats.paver, plaza = this.mats.plaza, refl = rainy ? this.reflection : null;
    asphalt.metallicTexture = rainy ? this.puddles : null;
    if (rainy) { asphalt.useRoughnessFromMetallicTextureGreen = true; asphalt.useMetallnessFromMetallicTextureBlue = true; asphalt.useRoughnessFromMetallicTextureAlpha = false; asphalt.metallic = 0; asphalt.roughness = 1; (this.puddles).uScale = 1; }
    else { asphalt.metallic = 0; asphalt.roughness = 0.93; }
    asphalt.albedoColor = rainy ? new Color3(0.42, 0.43, 0.46) : Color3.White();
    asphalt.reflectionTexture = refl; asphalt.environmentIntensity = night ? 1.5 : 0.9;
    for (const m of [paver, plaza]) { m.roughness = rainy ? 0.32 : m === paver ? 0.86 : 0.8; m.albedoColor = rainy ? new Color3(0.55, 0.55, 0.57) : Color3.White(); m.reflectionTexture = refl; m.environmentIntensity = night ? 1.2 : 0.7; }
    this.mats.paint.roughness = rainy ? 0.35 : 0.6;
    this.fac[0].mat.environmentIntensity = night ? 1.1 : 0.8;
    if (this.mats.bronze) this.mats.bronze.reflectionTexture = this.reflection;
    if (this.rain) this.rain.emitRate = rainy ? (effects === 0 ? 900 : 2600) : 0;
    this.probe?.cubeTexture.resetRefreshCounter();
  }

  update(dt: number, t: number, cam: Vector3, px: number, pz: number) {
    for (const sc of this.screens) sc.update(t);
    // the shadow frustum follows the player (snapped to avoid shimmering)
    const sx = Math.round(px / 4) * 4, sz = Math.round(pz / 4) * 4, d = this.sun.direction;
    this.sun.position.set(sx - d.x * 240, -d.y * 240, sz - d.z * 240);
    if (this.rain && this.rain.emitRate > 0) (this.rain.emitter as Vector3).set(cam.x, cam.y + 13, cam.z);
    // trains pass on the viaduct every so often
    let on = false;
    for (const tr of this.trains) {
      if (tr.wait > 0) { tr.wait -= dt; if (tr.wait <= 0) tr.mesh.position.z = -330 * tr.dir; continue; }
      tr.mesh.position.z += tr.dir * 17 * dt;
      if (Math.abs(tr.mesh.position.z) < 200) { on = true; this.train.x = tr.mesh.position.x; this.train.z = Math.max(-80, Math.min(80, tr.mesh.position.z)); }
      if (tr.mesh.position.z * tr.dir > 330) tr.wait = 30 + Math.random() * 35;
    }
    this.train.on = on;
  }

  /** Night-time refresh so reflections follow the animated screens. */
  refreshReflections() { this.probe?.cubeTexture.resetRefreshCounter(); }
  get colliderCount() { return colliders.boxes.length + colliders.circles.length; }
}
