// CrowdManager: spawning/despawning, steering, animation LOD, umbrellas and distant crowd impostors.
import { Scene, Mesh, PBRMaterial, Color3, Matrix, Quaternion, Vector3, ShadowGenerator, Camera } from "@babylonjs/core";
import { createCharacter, randomLook, Archetype, Look, characterMaterial } from "./characters/CharacterFactory";
import { animate, newAnim, PoseId } from "./characters/animation";
import { Geo, hex } from "./characters/Geo";
import { NPC, NPCBehaviorSystem, PlayerInfo, buildRoute, P2 } from "./NPCBehaviorSystem";
import { ARMS, Arm, LOITER_SPOTS, clamp, damp, groundY, inScrambleZone, onRoad, resolveStatic, sidewalkDist, angDiff, mulberry } from "./world/layout";
import * as D from "./dialogue";

const WILLING: Record<Archetype, number> = { fashion: 0.78, harajuku: 0.88, tourist: 0.72, student: 0.55, business: 0.28, influencer: 0.96, casual: 0.55, photographer: 0 };
const POSE_SETS: PoseId[][] = [
  ["smile", "peace", "hipHand"], ["pockets", "sideTurn", "smile"], ["fixJacket", "smile", "backTurn"],
  ["peace", "cheer", "wave"], ["hipHand", "sideTurn", "backTurn", "smile"], ["smile", "pockets", "peace"],
];

export class CrowdManager {
  npcs: NPC[] = [];
  target = 36;
  raining = false;
  private nextId = 1;
  private spawnT = 0;
  private umbSrc: Mesh | null = null;
  private umbMats: PBRMaterial[] = [];
  private imp: { meshes: Mesh[]; data: { arm: number; s: number; dir: number; speed: number; lat: number; ph: number; sc: number }[]; bufs: Float32Array[]; lanes: { a: P2; b: P2 }[] } | null = null;
  private frame = 0;
  onRoadPeople: P2[] = [];

  constructor(private scene: Scene, private behavior: NPCBehaviorSystem, private shadows: () => ShadowGenerator | null) {}

  // ---------- population ----------
  setTarget(density: number) { this.target = Math.round(clamp(38 * density, 14, 64)); }

  populate(onProgress: (f: number) => void) {
    const n = this.target;
    const step = (i: number): Promise<void> => new Promise((res) => {
      const end = Math.min(n, i + 4);
      for (; i < end && this.npcs.length < n; i++) this.spawn(true);
      onProgress(Math.min(1, this.npcs.length / n));
      if (this.npcs.length >= n || i >= n * 2) res(); else setTimeout(() => step(i).then(res), 0);
    });
    return step(0);
  }

  private pickArm(exclude?: Arm): Arm {
    const list = ARMS.filter((a) => a !== exclude);
    let t = Math.random() * list.reduce((s, a) => s + a.weight, 0);
    for (const a of list) { t -= a.weight; if (t <= 0) return a; }
    return list[0];
  }

  private makeNpc(look: Look, x: number, z: number): NPC {
    const id = this.nextId++;
    const visual = createCharacter(this.scene, look);
    const anim = newAnim((id * 0.6180339) % 1);
    anim.phoneIdle = false; anim.stiffR = look.briefcase;
    const pool = look.arche === "tourist" ? D.NAMES_TOURIST : look.female ? D.NAMES_F : D.NAMES_M;
    const r = mulberry(id * 31 + 7);
    const shy = r() < 0.18;
    const willing = WILLING[look.arche] * (shy ? 0.35 : 1);
    const pr = r();
    const n: NPC = {
      id, name: pool[Math.floor(r() * pool.length)], visual, anim, look,
      x, z, yaw: 0, vx: 0, vz: 0,
      baseSpeed: (look.arche === "business" ? 1.5 : look.arche === "tourist" ? 1.15 : 1.3) + r() * 0.25,
      state: "SPAWNING", stateT: 0, route: [], seg: 0, wp: 0, lane: 0.5 + r() * 2.3, cross: null,
      target: null, wantSpeed: 0, faceYaw: null, timer: 0,
      willing, willAccept: r() < willing,
      prefer: look.arche === "business" ? "walk" : pr < 0.32 ? "walk" : pr < 0.6 ? "static" : "either",
      poses: POSE_SETS[Math.floor(r() * POSE_SETS.length)], idlePose: look.phone ? "phone" : r() < 0.25 ? "armsCrossed" : "none",
      session: null, done: false, leader: null, followers: [], slot: 0, umb: null, dist: 0, chatT: 5 + r() * 30, sayQueue: [], gone: false,
    };
    this.shadows()?.addShadowCaster(visual.mesh);
    if (this.raining) this.giveUmbrella(n);
    this.npcs.push(n);
    return n;
  }

  /** Spawn one NPC (or a small group) at a route entry. `initial` scatters them along the route. */
  spawn(initial: boolean, cam?: { x: number; z: number; fx: number; fz: number }) {
    const entry = this.pickEntry(cam);
    if (!entry) return;
    const exit = this.pickArm(entry);
    const seed = this.nextId * 131 + Math.floor(Math.random() * 1e6);
    const look = randomLook(seed);
    const lane = 0.5 + Math.random() * 2.3;
    const loiter = Math.random() < 0.14 ? LOITER_SPOTS[Math.floor(Math.random() * LOITER_SPOTS.length)] : undefined;
    const route = buildRoute(entry, exit, lane, loiter ? { x: loiter.x + (Math.random() - 0.5) * 2, z: loiter.z + (Math.random() - 0.5) * 2 } : undefined);
    const first = route[0] as { k: "walk"; pts: P2[] };
    let start = first.pts[0], wp = 1;
    if (initial) {
      // random point along the entry polyline
      const pts = first.pts;
      const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.z - pts[i].z));
      let d = (0.12 + Math.random() * 0.86) * lens.reduce((a, b) => a + b, 0);
      let i = 0;
      while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
      const t = clamp(d / (lens[i] || 1), 0, 1);
      start = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t };
      wp = i + 1;
    }
    const n = this.makeNpc(look, start.x, start.z);
    n.route = route; n.wp = wp; n.lane = lane;
    const nx = first.pts[Math.min(wp, first.pts.length - 1)];
    n.yaw = Math.atan2(nx.x - start.x, nx.z - start.z);
    // couples and friend groups
    if (Math.random() < 0.26 && this.npcs.length < this.target + 2) {
      const count = Math.random() < 0.25 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const fl = randomLook(seed + 17 * (i + 1), Math.random() < 0.6 ? look.arche : undefined);
        const f = this.makeNpc(fl, start.x + (i ? -0.7 : 0.7), start.z + 0.2);
        f.leader = n; f.slot = i ? -1 : 1; f.yaw = n.yaw; f.baseSpeed = n.baseSpeed; f.state = "WALKING";
        n.followers.push(f);
      }
      n.baseSpeed *= 0.92;
    }
  }

  private pickEntry(cam?: { x: number; z: number; fx: number; fz: number }): Arm | null {
    for (let tries = 0; tries < 6; tries++) {
      const a = this.pickArm();
      if (!cam) return a;
      const e = a.pts[a.pts.length - 1], dx = e.x - cam.x, dz = e.z - cam.z, d = Math.hypot(dx, dz);
      const facing = (dx * cam.fx + dz * cam.fz) / (d || 1);
      // only where the camera cannot see the pop-in: far away, behind the camera, or inside the station doorway
      if (a.door || d > 68 || facing < 0.1) return a;
    }
    return null;
  }

  private remove(n: NPC) {
    n.gone = true;
    this.behavior.forget(n);
    this.shadows()?.removeShadowCaster(n.visual.mesh);
    n.umb?.dispose();
    n.visual.dispose();
    if (n.leader) n.leader.followers = n.leader.followers.filter((f) => f !== n);
    for (const f of n.followers) f.leader = null, (f.state = "DESPAWNING");
  }

  // ---------- umbrellas ----------
  setRain(on: boolean) {
    this.raining = on;
    for (const n of this.npcs) { if (on) this.giveUmbrella(n); else { n.umb?.dispose(); n.umb = null; n.anim.umbrella = false; } }
  }
  private giveUmbrella(n: NPC) {
    if (n.umb || n.id % 9 === 0) return; // a few people brave the rain
    if (!this.umbSrc) {
      const g = new Geo();
      const w = hex("#ffffff"), dk = hex("#2a2a2c");
      const ring = (r: number, y: number) => ({ c: [0, y, 0] as [number, number, number], u: [r, 0, 0] as [number, number, number], v: [0, 0, r] as [number, number, number], col: w });
      g.tube([ring(0.56, 0), ring(0.47, 0.1), ring(0.3, 0.185), ring(0.03, 0.23)], 8, false, false);
      g.path([[0, 0.24, 0], [0, -0.72, 0]], [0.007], dk, undefined, 5);
      g.path([[0, -0.72, 0], [0, -0.8, 0.02], [0, -0.82, 0.06]], [0.012], dk, undefined, 5);
      this.umbSrc = g.toMesh("umbrellaSrc", this.scene);
      this.umbSrc.setEnabled(false);
      const cols: [string, number][] = [["#f4f6f8", 0.42], ["#f4f6f8", 0.42], ["#15161a", 1], ["#1f2f55", 1], ["#b8322f", 1], ["#e9d9a8", 1]];
      this.umbMats = cols.map(([c, al], i) => {
        const m = new PBRMaterial("umb" + i, this.scene);
        m.albedoColor = Color3.FromHexString(c).toLinearSpace(); m.metallic = 0; m.roughness = al < 1 ? 0.15 : 0.6; m.alpha = al;
        m.backFaceCulling = false; m.twoSidedLighting = true;
        return m;
      });
    }
    const u = this.umbSrc.clone("umb" + n.id);
    u.setEnabled(true);
    u.material = this.umbMats[n.id % this.umbMats.length];
    u.parent = n.visual.mesh;
    u.position.set(0.16, 1.94, 0.1);
    u.rotation.z = -0.1;
    u.isPickable = false;
    n.umb = u; n.anim.umbrella = true;
  }

  // ---------- impostors ----------
  buildImpostors(count: number) {
    this.imp?.meshes.forEach((m) => m.dispose());
    const lanes: { a: P2; b: P2 }[] = [];
    for (const arm of ARMS) {
      if (arm.door) continue;
      const e = arm.pts[arm.pts.length - 1], p = arm.pts[arm.pts.length - 2];
      const dx = e.x - p.x, dz = e.z - p.z, l = Math.hypot(dx, dz);
      const startD = 70 - Math.max(Math.abs(p.x), Math.abs(p.z));
      const s0 = clamp(startD, 2, l - 10);
      lanes.push({ a: { x: p.x + (dx / l) * s0, z: p.z + (dz / l) * s0 }, b: e });
    }
    const meshes: Mesh[] = [];
    for (const ph of [Math.PI / 2, (3 * Math.PI) / 2]) {
      const look = randomLook(4242, "casual");
      const white: [number, number, number] = [0.85, 0.85, 0.85];
      Object.assign(look, { topCol: white, bottomCol: [0.45, 0.45, 0.5], innerCol: white, top: "long", bottom: "pants", backpack: null, tote: null, phone: false, mask: false, headphones: false, hat: "none", hairStyle: "short", height: 1.74 });
      const c = createCharacter(this.scene, look, 6);
      const a = newAnim(0.3); a.phase = ph; a.speed = 1.4;
      animate(c, a, 1, 0);
      c.skeleton.prepare(true);
      c.mesh.applySkeleton(c.skeleton);
      c.mesh.skeleton = null;
      c.skeleton.dispose();
      const m = c.mesh;
      m.name = "impostor";
      const mat = new PBRMaterial("impostorMat", this.scene);
      mat.albedoColor = Color3.White(); mat.metallic = 0; mat.roughness = 0.8; mat.backFaceCulling = false; mat.twoSidedLighting = true;
      m.material = mat; m.scaling.setAll(1);
      m.alwaysSelectAsActiveMesh = true; m.isPickable = false;
      meshes.push(m);
    }
    const data: NonNullable<CrowdManager["imp"]>["data"] = [];
    const colors = new Float32Array(count * 4);
    const tints = ["#d9d6cf", "#2b2d33", "#3d5d86", "#8a7f70", "#b03a3a", "#e7c53b", "#f6b9cf", "#1b1c20", "#59636e", "#3f8f5f", "#f1efe9", "#4a3f35"].map(hex);
    for (let i = 0; i < count; i++) {
      const t = tints[i % tints.length];
      colors.set([t[0] * 1.2, t[1] * 1.2, t[2] * 1.2, 1], i * 4);
      data.push({ arm: i % lanes.length, s: Math.random(), dir: Math.random() < 0.5 ? 1 : -1, speed: 1.1 + Math.random() * 0.5, lat: (Math.random() - 0.5) * 5.4, ph: Math.random() * 6.28, sc: 0.9 + Math.random() * 0.14 });
    }
    const bufs = meshes.map((m) => {
      const b = new Float32Array(count * 16);
      m.thinInstanceSetBuffer("matrix", b, 16, false);
      m.thinInstanceSetBuffer("color", colors, 4, true);
      return b;
    });
    this.imp = { meshes, data, bufs, lanes };
  }

  private updateImpostors(dt: number) {
    const im = this.imp;
    if (!im) return;
    const m = TmpM, q = TmpQ, s = TmpS, p = TmpP;
    for (let i = 0; i < im.data.length; i++) {
      const d = im.data[i], lane = im.lanes[d.arm];
      const dx = lane.b.x - lane.a.x, dz = lane.b.z - lane.a.z, len = Math.hypot(dx, dz);
      d.s += (d.dir * d.speed * dt) / len;
      if (d.s > 1) { d.s = 1; d.dir = -1; } else if (d.s < 0) { d.s = 0; d.dir = 1; }
      d.ph += dt * d.speed * 4.4;
      const ux = dx / len, uz = dz / len;
      const lat = d.lat * (d.dir > 0 ? 1 : 1) + d.dir * 0.8;
      const x = lane.a.x + dx * d.s - uz * lat, z = lane.a.z + dz * d.s + ux * lat;
      const which = Math.sin(d.ph) > 0 ? 0 : 1;
      Quaternion.RotationYawPitchRollToRef(Math.atan2(ux * d.dir, uz * d.dir), 0, 0, q);
      p.set(x, groundY(x, z) + Math.abs(Math.cos(d.ph)) * 0.025, z);
      for (let k = 0; k < 2; k++) {
        s.setAll(k === which ? d.sc : 0);
        Matrix.ComposeToRef(s, q, p, m);
        m.copyToArray(im.bufs[k], i * 16);
      }
    }
    im.meshes.forEach((mesh) => mesh.thinInstanceBufferUpdated("matrix"));
  }

  // ---------- frame update ----------
  update(dt: number, pl: PlayerInfo, cam: Camera) {
    this.frame++;
    const cp = cam.globalPosition, fwd = cam.getForwardRay(1).direction;
    const camInfo = { x: cp.x, z: cp.z, fx: fwd.x, fz: fwd.z };
    const npcs = this.npcs;

    // spawn / despawn
    this.spawnT -= dt;
    if (npcs.length < this.target && this.spawnT <= 0) { this.spawn(false, camInfo); this.spawnT = 0.5 + Math.random() * 0.9; }
    for (let i = npcs.length - 1; i >= 0; i--) {
      const n = npcs[i];
      if (n.state !== "DESPAWNING") continue;
      const dx = n.x - cp.x, dz = n.z - cp.z, d = Math.hypot(dx, dz);
      const visible = d < 60 && (dx * fwd.x + dz * fwd.z) / (d || 1) > 0.2;
      const insideDoor = n.x > 46 && n.z < -20 && n.z > -34;
      if (!visible || insideDoor || n.stateT > 12 || (n.stateT += dt, false)) { this.remove(n); npcs.splice(i, 1); }
      else { n.stateT += dt; n.target = { x: n.x + Math.sin(n.yaw) * 4, z: n.z + Math.cos(n.yaw) * 4 }; n.wantSpeed = n.baseSpeed; }
    }

    // behaviour
    for (const n of npcs) if (n.state !== "DESPAWNING") this.behavior.update(n, dt);

    // steering + integration
    this.onRoadPeople.length = 0;
    for (const n of npcs) {
      let dvx = 0, dvz = 0;
      if (n.target) {
        const dx = n.target.x - n.x, dz = n.target.z - n.z, d = Math.hypot(dx, dz);
        if (d > 0.05) { const sp = Math.min(n.wantSpeed, d * 3 + 0.3); dvx = (dx / d) * sp; dvz = (dz / d) * sp; }
      }
      const moving = dvx !== 0 || dvz !== 0;
      const hx = Math.sin(n.yaw), hz = Math.cos(n.yaw);
      let ax = 0, az = 0;
      for (const o of npcs) {
        if (o === n) continue;
        const dx = n.x - o.x, dz = n.z - o.z;
        if (dx > 1.7 || dx < -1.7 || dz > 1.7 || dz < -1.7) continue;
        const d = Math.hypot(dx, dz);
        const group = o.leader === n || n.leader === o || (n.leader && n.leader === o.leader);
        const R = group ? 0.55 : 1.5;
        if (d >= R || d < 1e-4) continue;
        const k = (R - d) / R;
        if (moving) {
          ax += (dx / d) * k * 1.5; az += (dz / d) * k * 1.5;
          // sidestep to the left when someone is ahead
          if (!group && -(dx * hx + dz * hz) / d > 0.3) { ax += -hz * k * 0.9; az += hx * k * 0.9; }
        }
        // hard separation
        const minD = group ? 0.42 : 0.5;
        if (d < minD) { const push = (minD - d) * 0.5; n.x += (dx / d) * push; n.z += (dz / d) * push; }
      }
      // keep clear of the player (unless they are working together)
      {
        const dx = n.x - pl.x, dz = n.z - pl.z, d = Math.hypot(dx, dz);
        if (d < 1.3 && d > 1e-4 && moving && !n.session && n.state !== "INTERACTING") { const k = (1.3 - d) / 1.3; ax += (dx / d) * k * 1.8; az += (dz / d) * k * 1.8; }
        if (d < 0.55 && d > 1e-4) { const push = (0.55 - d) * 0.6; n.x += (dx / d) * push; n.z += (dz / d) * push; }
      }
      const tvx = dvx + (moving ? ax : 0), tvz = dvz + (moving ? az : 0);
      n.vx = damp(n.vx, tvx, 7, dt); n.vz = damp(n.vz, tvz, 7, dt);
      const ox = n.x, oz = n.z;
      n.x += n.vx * dt; n.z += n.vz * dt;
      const crossing = n.state === "CROSSING" || n.state === "WALKING_FOR_PHOTO" || n.state === "CLEARING_CROSSING";
      if (!crossing && !(n.x > 43)) {
        // pedestrians who are not crossing never drift onto the roadway
        const sd = sidewalkDist(n.x, n.z);
        if (sd < 0.4) {
          const gx = sidewalkDist(n.x + 0.2, n.z) - sidewalkDist(n.x - 0.2, n.z), gz = sidewalkDist(n.x, n.z + 0.2) - sidewalkDist(n.x, n.z - 0.2);
          const gl = Math.hypot(gx, gz) || 1;
          n.x += (gx / gl) * (0.4 - sd) * 0.5; n.z += (gz / gl) * (0.4 - sd) * 0.5;
        }
      }
      resolveStatic(n, 0.25);
      const moved = Math.hypot(n.x - ox, n.z - oz);
      const sp = moved / Math.max(dt, 1e-4);
      n.anim.speed = damp(n.anim.speed, sp, 10, dt);
      const wantYaw = sp > 0.25 ? Math.atan2(n.vx, n.vz) : n.faceYaw;
      if (wantYaw !== null && wantYaw !== undefined) n.yaw += angDiff(n.yaw, wantYaw) * (1 - Math.exp(-(sp > 0.25 ? 9 : 5) * dt));
      if (onRoad(n.x, n.z)) this.onRoadPeople.push(n);

      // visuals + animation LOD
      const m = n.visual.mesh;
      const dx = n.x - cp.x, dz = n.z - cp.z, d = Math.hypot(dx, dz);
      n.dist = d;
      m.position.set(n.x, groundY(n.x, n.z), n.z);
      m.rotation.y = n.yaw + n.anim.yawOff;
      const behind = d > 5 && (dx * fwd.x + dz * fwd.z) / d < -0.25;
      const every = behind ? 8 : d > 70 ? 4 : d > 38 ? 2 : 1;
      if ((this.frame + n.id) % every === 0) animate(n.visual, n.anim, dt * every, moved * every);
      else n.anim.phase += 0; // phase catches up on the next animated frame

      // ambient chatter
      n.chatT -= dt;
      if (n.chatT <= 0) {
        n.chatT = 25 + Math.random() * 50;
        if (d < 9 && !n.session && (n.followers.length || n.leader) && n.state !== "INTERACTING") this.behavior["hooks"].say(n, "", Math.random() < 0.5 ? "laugh" : "greet");
      }
    }
    this.updateImpostors(dt);
  }

  /** True while anybody (NPC) is still on the scramble. */
  peopleOnCrossing(): boolean {
    for (const n of this.npcs) if (inScrambleZone(n.x, n.z)) return true;
    return false;
  }

  /** Closest NPC the player is facing, within reach. */
  nearest(pl: PlayerInfo, reach = 2.6): NPC | null {
    let best: NPC | null = null, bd = reach;
    const fx = Math.sin(pl.yaw), fz = Math.cos(pl.yaw);
    for (const n of this.npcs) {
      const dx = n.x - pl.x, dz = n.z - pl.z, d = Math.hypot(dx, dz);
      if (d > bd || n.state === "DESPAWNING") continue;
      if (d > 0.8 && (dx * fx + dz * fz) / d < 0.25) continue;
      bd = d; best = n;
    }
    return best;
  }

  dispose() {
    for (const n of this.npcs) this.remove(n);
    this.npcs.length = 0;
    this.imp?.meshes.forEach((m) => m.dispose());
    this.umbSrc?.dispose();
  }
}

const TmpM = new Matrix(), TmpQ = new Quaternion(), TmpS = new Vector3(), TmpP = new Vector3();
void characterMaterial;
