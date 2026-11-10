// NPC state machine: routes, waiting, crossing, consent, posing, photo reactions, signal reactions.
import type { Mesh } from "@babylonjs/core";
import type { CharacterVisual, Look } from "./characters/CharacterFactory";
import type { AnimState, PoseId } from "./characters/animation";
import type { IntersectionController } from "./IntersectionController";
import { ARMS, Arm, CORNERS, CornerId, Crossing, crossingLine, hub, onRoad, sidewalkDist, angDiff } from "./world/layout";
import * as D from "./dialogue";

export type NPCState =
  | "SPAWNING" | "IDLE" | "WALKING" | "WAITING_AT_CROSSING" | "CROSSING" | "INTERACTING" | "CONSENTING" | "DECLINING"
  | "POSING" | "WALKING_FOR_PHOTO" | "REACTING_TO_PHOTO" | "CLEARING_CROSSING" | "RETURNING_TO_ROUTE" | "DESPAWNING";

export interface P2 { x: number; z: number }
export type Seg = { k: "walk"; pts: P2[] } | { k: "cross"; from: CornerId; to: CornerId } | { k: "idle"; at: P2; dur: number };

export interface CrossState {
  line: Crossing; from: CornerId; to: CornerId; wait: P2; len: number;
  started: boolean; stage: 0 | 1; delay: number | null; retreat: boolean; runner: boolean; back: number;
}
export interface Session {
  type: "walk" | "static"; shots: number; best: number; wanted: number; poseT: number; poseIdx: number;
  retried: boolean; hurrySaid: boolean; goSaid: boolean; wrapAt: number | null; t: number;
}

export interface NPC {
  id: number; name: string; visual: CharacterVisual; anim: AnimState; look: Look;
  x: number; z: number; yaw: number; vx: number; vz: number; baseSpeed: number;
  state: NPCState; stateT: number;
  route: Seg[]; seg: number; wp: number; lane: number;
  cross: CrossState | null;
  target: P2 | null; wantSpeed: number; faceYaw: number | null;
  timer: number;
  willing: number; willAccept: boolean; prefer: "walk" | "static" | "either";
  poses: PoseId[]; idlePose: PoseId;
  session: Session | null; done: boolean;
  leader: NPC | null; followers: NPC[]; slot: number;
  umb: Mesh | null; dist: number; chatT: number; sayQueue: { t: number; text: string }[];
  gone: boolean;
}

export interface PlayerInfo { x: number; z: number; yaw: number; speed: number; camX: number; camY: number; camZ: number; aiming: boolean; name: string }

export interface BehaviorHooks {
  say(npc: NPC, text: string, voice?: "greet" | "surprise" | "laugh"): void;
  dialogue(d: { npcName: string; tag: string; lines: { who: string; text: string }[]; choices: { label: string }[] } | null): void;
  session(s: { npcName: string; type: string; hint: string } | null): void;
  playerGesture(on: boolean): void;
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------- Routes ----------
/** Arm polyline shifted to the walker's left-hand side (people keep left). outward: hub → end. */
export function armPath(arm: Arm, outward: boolean, lane: number): P2[] {
  const src = outward ? arm.pts : [...arm.pts].reverse();
  return src.map((p, i) => {
    const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    // the station doorway is narrow: squeeze the lane there
    const k = arm.door && p.x > 40 ? 0.45 : 1;
    return { x: p.x + (-dz / l) * lane * k, z: p.z + (dx / l) * lane * k };
  });
}
export function cornerSteps(from: CornerId, to: CornerId): Seg[] {
  if (from === to) return [];
  const A = CORNERS[from], Bc = CORNERS[to];
  if (A.sx !== Bc.sx && A.sz !== Bc.sz && Math.random() < 0.3) {
    const mid = (Object.keys(CORNERS) as CornerId[]).find((c) => CORNERS[c].sx === Bc.sx && CORNERS[c].sz === A.sz)!;
    return [{ k: "cross", from, to: mid }, { k: "cross", from: mid, to }];
  }
  return [{ k: "cross", from, to }];
}
export function buildRoute(entry: Arm, exit: Arm, lane: number, loiter?: P2): Seg[] {
  const r: Seg[] = [{ k: "walk", pts: armPath(entry, false, lane) }];
  if (loiter) r.push({ k: "idle", at: loiter, dur: 15 + Math.random() * 40 });
  r.push(...cornerSteps(entry.corner, exit.corner));
  r.push({ k: "walk", pts: armPath(exit, true, lane) });
  return r;
}
export const nearestCorner = (x: number, z: number): CornerId => (z >= 0 ? (x >= 0 ? "NE" : "NW") : x >= 0 ? "SE" : "SW");

export class NPCBehaviorSystem {
  sessionNpc: NPC | null = null;
  dialogueNpc: NPC | null = null;
  private dlg: { t: number; replied: boolean; options: ("walk" | "static" | "bye")[]; lines: { who: string; text: string }[] } | null = null;

  constructor(private signal: IntersectionController, private hooks: BehaviorHooks, private player: () => PlayerInfo) {}

  set(n: NPC, s: NPCState) { n.state = s; n.stateT = 0; }

  private say(n: NPC, text: string, delay = 0, voice?: "greet" | "surprise" | "laugh") {
    if (delay <= 0) this.hooks.say(n, text, voice); else n.sayQueue.push({ t: delay, text });
  }

  // ---------- per-frame ----------
  update(n: NPC, dt: number) {
    n.stateT += dt;
    for (let i = n.sayQueue.length - 1; i >= 0; i--) { const q = n.sayQueue[i]; q.t -= dt; if (q.t <= 0) { this.hooks.say(n, q.text); n.sayQueue.splice(i, 1); } }
    if (n.leader) { this.follower(n, dt); return; }
    const pl = this.player();
    const a = n.anim;
    n.faceYaw = null; a.looking = false;
    if (n.session) n.session.t += dt;

    switch (n.state) {
      case "SPAWNING": n.target = null; if (n.stateT > 0.15) this.set(n, "WALKING"); break;

      case "RETURNING_TO_ROUTE": n.target = null; a.pose = "none"; if (n.stateT > 0.45) this.set(n, "WALKING"); break;

      case "WALKING": {
        a.pose = "none";
        const seg = n.route[n.seg];
        if (!seg) { this.set(n, "DESPAWNING"); break; }
        n.wantSpeed = n.baseSpeed;
        if (seg.k === "walk") {
          const p = seg.pts[n.wp];
          if (!p) { this.nextSeg(n); break; }
          n.target = p;
          if (dist(n, p) < 0.9) { n.wp++; if (n.wp >= seg.pts.length) this.nextSeg(n); }
        } else if (seg.k === "idle") {
          n.target = seg.at;
          if (dist(n, seg.at) < 0.7) { n.timer = seg.dur; this.set(n, "IDLE"); }
        } else {
          if (!n.cross) this.setupCross(n, seg.from, seg.to);
          if (this.canStart(n)) this.beginCross(n); else this.set(n, "WAITING_AT_CROSSING");
        }
        if (n.session) this.lookAtPlayer(n, pl, 0.6);
        break;
      }

      case "IDLE":
        n.target = null; a.pose = n.idlePose; n.timer -= dt;
        if (n.idlePose === "none" && Math.sin(a.t * 0.5 + n.id) > 0.3) { a.looking = true; a.lookYaw = Math.sin(a.t * 0.37 + n.id) * 0.9; a.lookPitch = 0; }
        if (n.timer <= 0) { this.nextSeg(n); if (n.state === "IDLE") this.set(n, "WALKING"); }
        break;

      case "WAITING_AT_CROSSING": {
        const c = n.cross;
        if (!c) { this.set(n, "WALKING"); break; }
        const d = dist(n, c.wait);
        n.target = d > 0.35 ? c.wait : null; n.wantSpeed = n.baseSpeed;
        n.faceYaw = Math.atan2(c.line.b.x - c.line.a.x, c.line.b.z - c.line.a.z);
        a.pose = n.session ? "none" : d < 1 && n.idlePose === "phone" ? "phone" : "none";
        // glance around / at passing traffic while waiting
        if (!n.session && Math.sin(a.t * 0.6 + n.id * 1.7) > 0.5) { a.looking = true; a.lookYaw = Math.sin(a.t * 0.9 + n.id) * 0.8; a.lookPitch = 0; }
        if (n.session) this.lookAtPlayer(n, pl, 1);
        if (this.canStart(n)) {
          if (c.delay === null) c.delay = Math.random() * 1.3 + c.back * 0.45;
          c.delay -= dt;
          if (c.delay <= 0) this.beginCross(n);
        } else c.delay = null;
        break;
      }

      case "CROSSING":
      case "WALKING_FOR_PHOTO": {
        const c = n.cross!;
        const ph = this.signal.phase;
        const s = n.session;
        n.target = c.stage === 0 ? c.line.a : c.line.b;
        if (c.stage === 0 && dist(n, c.line.a) < 0.8) c.stage = 1;
        const hurry = ph === "PED_WARNING";
        n.wantSpeed = hurry ? (c.runner ? 3.3 : n.baseSpeed * 1.5) : n.baseSpeed * (s ? 0.86 : 1);
        if (s) {
          if (hurry) {
            a.pose = "none"; a.smile = 0;
            if (!s.hurrySaid) { s.hurrySaid = true; this.say(n, pick(D.LIGHT_CHANGING), 0, "surprise"); }
          } else {
            if (!s.goSaid && c.stage === 1) { s.goSaid = true; this.say(n, pick(D.WALK_GO), 0, "greet"); }
            s.poseT -= dt;
            if (s.poseT <= 0) { s.poseT = 2.6 + Math.random() * 1.6; s.poseIdx++; }
            a.pose = (["smile", "peace", "none", "wave", "smile"] as PoseId[])[s.poseIdx % 5];
            this.lookAtPlayer(n, pl, 1);
          }
        }
        if (ph !== "PED_GREEN" && ph !== "PED_WARNING" && onRoad(n.x, n.z)) {
          const prog = 1 - dist(n, c.line.b) / c.len;
          c.retreat = prog < 0.35; a.pose = "none";
          this.set(n, "CLEARING_CROSSING");
          break;
        }
        if (c.stage === 1 && dist(n, c.line.b) < 0.9) this.arrive(n);
        break;
      }

      case "CLEARING_CROSSING": {
        const c = n.cross!;
        const goal = c.retreat ? c.line.a : c.line.b;
        n.target = goal; n.wantSpeed = Math.max(3.1, n.baseSpeed * 2.1); a.pose = "none";
        if (!onRoad(n.x, n.z) && (dist(n, goal) < 1.2 || sidewalkDist(n.x, n.z) > 0.7)) {
          if (c.retreat) { c.started = false; c.stage = 0; c.delay = null; this.set(n, "WAITING_AT_CROSSING"); }
          else this.arrive(n);
        }
        break;
      }

      case "INTERACTING":
        n.target = null; n.faceYaw = Math.atan2(pl.x - n.x, pl.z - n.z); this.lookAtPlayer(n, pl, 1); a.pose = "none";
        if (n.stateT > 40) { this.endDialogue(); n.done = true; this.set(n, "RETURNING_TO_ROUTE"); }
        break;

      case "CONSENTING":
        n.target = null; n.faceYaw = Math.atan2(pl.x - n.x, pl.z - n.z); this.lookAtPlayer(n, pl, 1); a.pose = "nod";
        if (n.stateT > 1.0) this.startSession(n);
        break;

      case "DECLINING":
        n.target = null; n.faceYaw = Math.atan2(pl.x - n.x, pl.z - n.z); a.pose = n.id % 2 ? "decline" : "bow";
        if (n.stateT > 1.5) { n.done = true; this.set(n, "RETURNING_TO_ROUTE"); }
        break;

      case "POSING": {
        const s = n.session!;
        n.target = null; n.faceYaw = Math.atan2(pl.x - n.x, pl.z - n.z); this.lookAtCamera(n, pl);
        s.poseT -= dt;
        if (s.poseT <= 0) this.nextPose(n, true);
        a.pose = n.poses[s.poseIdx % n.poses.length];
        if (s.wrapAt !== null) { s.wrapAt -= dt; if (s.wrapAt <= 0) this.wrap(n, pick(D.WRAP)); }
        else if (s.t > 80 || dist(n, pl) > 17) this.wrap(n, pick(D.TIMEOUT));
        break;
      }

      case "REACTING_TO_PHOTO":
        n.target = null; n.faceYaw = Math.atan2(pl.x - n.x, pl.z - n.z); this.lookAtPlayer(n, pl, 1);
        a.pose = n.stateT < 0.2 ? "none" : n.id % 3 === 0 ? "bow" : "wave";
        if (n.stateT > 2.6) { n.done = true; this.set(n, "RETURNING_TO_ROUTE"); }
        break;

      case "DESPAWNING": n.target = null; break;
    }
  }

  private lookAtPlayer(n: NPC, pl: PlayerInfo, amount: number) {
    const a = n.anim;
    a.looking = true;
    a.lookYaw = angDiff(n.yaw, Math.atan2(pl.x - n.x, pl.z - n.z)) * amount;
    a.lookPitch = 0;
  }
  private lookAtCamera(n: NPC, pl: PlayerInfo) {
    const a = n.anim, dx = pl.camX - n.x, dz = pl.camZ - n.z;
    a.looking = true;
    a.lookYaw = angDiff(n.yaw, Math.atan2(dx, dz));
    a.lookPitch = -Math.atan2(pl.camY - 1.6 * n.visual.scale, Math.hypot(dx, dz));
  }

  private follower(n: NPC, _dt: number) {
    const L = n.leader!, a = n.anim;
    if (L.gone || L.state === "DESPAWNING") { n.state = "DESPAWNING"; n.target = null; return; }
    n.state = L.state;
    const hy = L.yaw, side = n.slot;
    const still = L.target === null;
    const tx = L.x + Math.cos(hy) * 0.72 * side - Math.sin(hy) * (still ? 0 : 0.2);
    const tz = L.z - Math.sin(hy) * 0.72 * side - Math.cos(hy) * (still ? 0 : 0.2);
    const d = Math.hypot(tx - n.x, tz - n.z);
    n.faceYaw = null; a.looking = false; a.pose = "none";
    if (still) {
      n.target = d > 0.3 ? { x: tx, z: tz } : null; n.wantSpeed = n.baseSpeed;
      n.faceYaw = L.faceYaw ?? L.yaw;
      if (L.state === "POSING") { a.pose = side > 0 ? "peace" : "smile"; this.lookAtCamera(n, this.player()); }
      else if (Math.sin(a.t * 0.8 + n.id) > 0) { a.looking = true; a.lookYaw = angDiff(n.yaw, Math.atan2(L.x - n.x, L.z - n.z)); a.lookPitch = 0; }
    } else {
      n.target = { x: tx + Math.sin(hy) * 1.2, z: tz + Math.cos(hy) * 1.2 };
      const ls = Math.hypot(L.vx, L.vz);
      n.wantSpeed = Math.min(3.6, Math.max(0.5, ls * (0.9 + Math.min(1, d) * 0.5)));
      if (Math.sin(a.t * 0.7 + n.id) > 0.4) { a.looking = true; a.lookYaw = angDiff(n.yaw, Math.atan2(L.x - n.x, L.z - n.z)) * 0.7; a.lookPitch = 0; }
    }
  }

  // ---------- crossing ----------
  private setupCross(n: NPC, from: CornerId, to: CornerId) {
    const line = crossingLine(from, to, Math.random());
    const len = dist(line.a, line.b), dx = (line.b.x - line.a.x) / len, dz = (line.b.z - line.a.z) / len;
    let back = 0.25 + Math.random() * Math.random() * 3.4;
    let wait = { x: line.a.x - dx * back, z: line.a.z - dz * back };
    for (let i = 0; i < 6 && sidewalkDist(wait.x, wait.z) < 0.3; i++) { back += 0.5; wait = { x: line.a.x - dx * back, z: line.a.z - dz * back }; }
    n.cross = { line, from, to, wait, len, started: false, stage: 0, delay: null, retreat: false, runner: Math.random() < 0.3, back };
  }
  private canStart(n: NPC): boolean {
    const c = n.cross!;
    if (this.signal.phase !== "PED_GREEN") return false;
    const need = (c.len + dist(n, c.line.a)) / (n.baseSpeed * (n.session ? 0.86 : 1));
    return this.signal.pedTimeLeft > need * 0.8 + 1;
  }
  private beginCross(n: NPC) {
    const c = n.cross!;
    c.started = true; c.stage = 0;
    this.set(n, n.session?.type === "walk" ? "WALKING_FOR_PHOTO" : "CROSSING");
  }
  private nextSeg(n: NPC) {
    n.seg++; n.wp = 0; n.cross = null;
    if (n.seg >= n.route.length) this.set(n, "DESPAWNING");
  }
  private arrive(n: NPC) {
    const c = n.cross!, s = n.session;
    if (s && s.type === "walk") {
      if (s.shots > 0) {
        this.say(n, D.reactLine(s.best), 0.3, "laugh");
        this.endSession(n);
        this.nextSeg(n);
        this.set(n, "REACTING_TO_PHOTO");
        return;
      }
      if (!s.retried) {
        s.retried = true; s.hurrySaid = false; s.goSaid = false;
        this.say(n, pick(D.WALK_RETRY));
        const exit = pick(ARMS.filter((a) => a.corner === c.from));
        n.route = [{ k: "cross", from: c.to, to: c.from }, { k: "walk", pts: armPath(exit, true, n.lane) }];
        n.seg = 0; n.wp = 0; n.cross = null;
        this.set(n, "WALKING");
        return;
      }
      this.say(n, pick(D.WALK_GIVEUP));
      this.endSession(n); n.done = true;
    }
    this.nextSeg(n);
    if (n.state !== "DESPAWNING") this.set(n, "WALKING");
  }

  // ---------- interaction ----------
  /** What the interaction prompt should say for this NPC, or null. */
  promptFor(n: NPC): { text: string; can: boolean } | null {
    const t = n.leader ?? n;
    if (this.dialogueNpc) return null;
    if (this.sessionNpc) {
      if (t === this.sessionNpc && t.state === "POSING") return { text: "Finish shoot", can: true };
      return null;
    }
    if (t.state === "CROSSING" || t.state === "CLEARING_CROSSING" || onRoad(t.x, t.z)) return { text: "On the crossing — talk on the sidewalk", can: false };
    if (t.state === "DESPAWNING" || t.state === "SPAWNING" || t.state === "DECLINING" || t.state === "REACTING_TO_PHOTO") return null;
    return { text: "Interact", can: true };
  }

  interact(n0: NPC) {
    const n = n0.leader ?? n0;
    const pr = this.promptFor(n);
    if (!pr || !pr.can) return;
    if (this.sessionNpc === n) { this.wrap(n, pick(D.WRAP)); return; }
    if (n.done) { this.say(n, pick(D.ALREADY)); return; }
    const pl = this.player();
    this.dialogueNpc = n;
    this.set(n, "INTERACTING");
    this.dlg = { t: 0, replied: false, options: [], lines: [{ who: pl.name || "Photographer", text: pick(D.ASK) }] };
    this.hooks.playerGesture(true);
    this.pushDialogue();
  }

  private pushDialogue() {
    const n = this.dialogueNpc, d = this.dlg;
    if (!n || !d) { this.hooks.dialogue(null); return; }
    const labels: Record<string, string> = { walk: "Walking portrait — shoot on the crossing", static: "Static portrait — pose here", bye: d.options.length === 1 ? "Thanks anyway" : "Never mind" };
    this.hooks.dialogue({ npcName: n.name, tag: D.ARCHE_TAG[n.look.arche], lines: [...d.lines], choices: d.options.map((o) => ({ label: labels[o] })) });
  }

  /** Dialogue timing (called every frame). */
  tick(dt: number) {
    const d = this.dlg, n = this.dialogueNpc;
    if (!d || !n) return;
    d.t += dt;
    if (!d.replied && d.t > 1.15) {
      d.replied = true;
      this.hooks.playerGesture(false);
      if (!n.willAccept) { d.lines.push({ who: n.name, text: pick(D.DECLINE) }); d.options = ["bye"]; this.hooks.say(n, "", "surprise"); }
      else {
        const pool = n.prefer === "walk" ? D.ACCEPT_WALK : n.prefer === "static" ? D.ACCEPT_STATIC : D.ACCEPT_EITHER;
        d.lines.push({ who: n.name, text: pick(pool) });
        d.options = n.prefer === "walk" ? ["walk", "bye"] : n.prefer === "static" ? ["static", "bye"] : ["walk", "static", "bye"];
        this.hooks.say(n, "", "greet");
      }
      this.pushDialogue();
    }
  }

  choose(i: number) {
    const d = this.dlg, n = this.dialogueNpc;
    if (!d || !n || !d.replied) return;
    const o = d.options[i];
    if (!o) return;
    this.endDialogue();
    if (o === "bye") {
      if (n.willAccept) { n.done = true; this.set(n, "RETURNING_TO_ROUTE"); } else { this.set(n, "DECLINING"); }
      return;
    }
    n.session = { type: o, shots: 0, best: 0, wanted: 2 + Math.floor(Math.random() * 3), poseT: 0, poseIdx: -1, retried: false, hurrySaid: false, goSaid: false, wrapAt: null, t: 0 };
    this.sessionNpc = n;
    this.set(n, "CONSENTING");
  }

  private endDialogue() {
    this.dlg = null; this.dialogueNpc = null;
    this.hooks.dialogue(null); this.hooks.playerGesture(false);
  }

  private startSession(n: NPC) {
    const s = n.session!;
    if (s.type === "static") {
      this.set(n, "POSING");
      this.nextPose(n, true);
      this.hooks.session({ npcName: n.name, type: "Static portrait", hint: "Raise the camera, frame, focus and shoot. Press E near them to finish." });
    } else {
      if (!(n.cross && !n.cross.started)) {
        const c0 = nearestCorner(n.x, n.z);
        const others = (Object.keys(CORNERS) as CornerId[]).filter((c) => c !== c0);
        const diag = others.find((c) => CORNERS[c].sx !== CORNERS[c0].sx && CORNERS[c].sz !== CORNERS[c0].sz)!;
        const c1 = Math.random() < 0.45 ? diag : pick(others);
        const exit = pick(ARMS.filter((a) => a.corner === c1));
        const h = hub(c0);
        n.route = [{ k: "walk", pts: [{ x: h.x + (Math.random() - 0.5) * 2, z: h.z + (Math.random() - 0.5) * 2 }] }, { k: "cross", from: c0, to: c1 }, { k: "walk", pts: armPath(exit, true, n.lane) }];
        n.seg = 0; n.wp = 0; n.cross = null;
      }
      this.set(n, "WALKING");
      if (this.signal.phase !== "PED_GREEN") this.say(n, pick(D.WALK_START_WAIT), 0.2);
      this.hooks.session({ npcName: n.name, type: "Walking portrait", hint: "Follow them onto the crossing at the green signal and shoot while they walk." });
    }
  }

  private nextPose(n: NPC, speak: boolean) {
    const s = n.session!;
    s.poseIdx++; s.poseT = 7 + Math.random() * 3;
    const p = n.poses[s.poseIdx % n.poses.length];
    if (speak && Math.random() < 0.75) {
      const friend = n.followers.length && s.poseIdx === 1;
      const lines = friend ? D.POSE_LINES.friend : D.POSE_LINES[p];
      if (lines) this.say(n, pick(lines), 0.2);
    }
  }

  private wrap(n: NPC, line: string) {
    this.say(n, line, 0, "greet");
    this.endSession(n);
    this.set(n, "REACTING_TO_PHOTO");
  }
  private endSession(n: NPC) {
    n.session = null; n.anim.smile = 0;
    if (this.sessionNpc === n) { this.sessionNpc = null; this.hooks.session(null); }
  }

  /** Called by the photography system after a scored shot of the session NPC. */
  onPhoto(score: number) {
    const n = this.sessionNpc;
    if (!n || !n.session) return;
    const s = n.session;
    s.shots++; s.best = Math.max(s.best, score);
    if (s.type === "static" && n.state === "POSING") {
      this.say(n, D.reactLine(score), 0.9, "laugh");
      if (s.shots >= s.wanted || (score >= 82 && s.shots >= 2)) s.wrapAt = 3.4;
      else { s.poseT = 2.2; }
    }
  }

  /** NPC was removed from the world. */
  forget(n: NPC) {
    if (this.dialogueNpc === n) this.endDialogue();
    if (this.sessionNpc === n) { this.sessionNpc = null; this.hooks.session(null); }
  }
}
