// PlayerController: movement, collision, first/third-person cameras and the player's own animation.
import { Scene, FreeCamera, Vector3, Mesh, MeshBuilder, PBRMaterial, Color3, ShadowGenerator } from "@babylonjs/core";
import { createCharacter, randomLook, CharacterVisual } from "./characters/CharacterFactory";
import { animate, newAnim, AnimState } from "./characters/animation";
import type { Input } from "./Input";
import type { Settings } from "../state/settings";
import type { PlayerInfo } from "./NPCBehaviorSystem";
import { PLAYER_LIMIT, clamp, damp, groundY, lerp, rayBoxes, resolveStatic, angDiff } from "./world/layout";

export const BASE_FOV = 0.92;

export class PlayerController {
  x = 16.5; z = -15.5; y = 0;
  yaw = -0.75; camYaw = -0.75; camPitch = 0.12;
  view: "tps" | "fps" = "tps";
  aiming = false; aim = 0;
  speed = 0; vx = 0; vz = 0;
  locked = false; // dialogue: no movement
  gesture = false;
  forced: { x: number; z: number } | null = null;
  camera: FreeCamera;
  visual: CharacterVisual; anim: AnimState;
  private prop: Mesh;
  private camDist = 3.4;
  private idleT = 0;
  private bobPhase = 0;
  stepEvent = false; private lastStep = 0;
  // set by the photography system every frame
  lensFov = BASE_FOV; shakeYaw = 0; shakePitch = 0;
  name = "";
  eye = new Vector3();

  constructor(private scene: Scene, shadows: ShadowGenerator | null) {
    this.camera = new FreeCamera("playerCam", new Vector3(0, 2, -10), scene);
    this.camera.minZ = 0.12; this.camera.maxZ = 600; this.camera.fov = BASE_FOV;
    this.camera.inputs.clear();
    scene.activeCamera = this.camera;
    this.visual = createCharacter(scene, randomLook(1, "photographer"), 16);
    this.anim = newAnim(0.37);
    shadows?.addShadowCaster(this.visual.mesh);
    // camera prop: body + lens, moves from chest to eye when raised
    const body = MeshBuilder.CreateBox("camBody", { width: 0.135, height: 0.09, depth: 0.06 }, scene);
    const lens = MeshBuilder.CreateCylinder("camLens", { diameter: 0.068, height: 0.085, tessellation: 20 }, scene);
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.07;
    const hump = MeshBuilder.CreateBox("camHump", { width: 0.05, height: 0.03, depth: 0.05 }, scene); hump.position.y = 0.055;
    this.prop = Mesh.MergeMeshes([body, lens, hump], true)!;
    const pm = new PBRMaterial("camPropMat", scene); pm.albedoColor = new Color3(0.012, 0.012, 0.014); pm.metallic = 0.2; pm.roughness = 0.45;
    this.prop.material = pm; this.prop.parent = this.visual.mesh; this.prop.isPickable = false;
    shadows?.addShadowCaster(this.prop);
  }

  info(): PlayerInfo {
    const c = this.camera.position;
    return { x: this.x, z: this.z, yaw: this.aiming || this.view === "fps" ? this.camYaw : this.yaw, speed: this.speed, camX: c.x, camY: c.y, camZ: c.z, aiming: this.aiming, name: this.name };
  }

  update(dt: number, input: Input, st: Settings, dyn: { boxes: { x0: number; x1: number; z0: number; z1: number }[]; people: { x: number; z: number }[] }) {
    // ----- look -----
    const sens = 0.0023 * st.sensitivity * clamp(this.camera.fov / BASE_FOV, 0.08, 1);
    this.camYaw += input.dx * sens;
    this.camPitch = clamp(this.camPitch + input.dy * sens * (st.invertY ? -1 : 1), this.view === "fps" || this.aiming ? -1.25 : -0.45, this.view === "fps" || this.aiming ? 1.25 : 1.1);

    // ----- move -----
    let mx = 0, mz = 0, want = 0;
    if (this.forced) {
      const dx = this.forced.x - this.x, dz = this.forced.z - this.z, d = Math.hypot(dx, dz);
      if (d > 0.15) { mx = dx / d; mz = dz / d; want = 3.4; }
    } else if (!this.locked) {
      const f = (input.is("forward") ? 1 : 0) - (input.is("back") ? 1 : 0), r = (input.is("right") ? 1 : 0) - (input.is("left") ? 1 : 0);
      if (f || r) {
        const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
        mx = sy * f + cy * r; mz = cy * f - sy * r;
        const l = Math.hypot(mx, mz); mx /= l; mz /= l;
        want = this.aiming ? 1.35 : input.is("run") ? 4.7 : 1.95;
      }
    }
    this.vx = damp(this.vx, mx * want, 10, dt); this.vz = damp(this.vz, mz * want, 10, dt);
    const ox = this.x, oz = this.z;
    const p = { x: this.x + this.vx * dt, z: this.z + this.vz * dt };
    resolveStatic(p, 0.3);
    for (const b of dyn.boxes) {
      const cx = clamp(p.x, b.x0, b.x1), cz = clamp(p.z, b.z0, b.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz, r = 0.4;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + (dx / d) * r; p.z = cz + (dz / d) * r; }
      else { const l = p.x - b.x0, rr = b.x1 - p.x, n = p.z - b.z0, f = b.z1 - p.z, m = Math.min(l, rr, n, f); if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === n) p.z = b.z0 - r; else p.z = b.z1 + r; }
    }
    let lean = 0;
    for (const o of dyn.people) {
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz);
      if (d < 0.55 && d > 1e-4) { const push = (0.55 - d) * 0.5; p.x += (dx / d) * push; p.z += (dz / d) * push; lean = Math.sign(dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw)) * 0.5; }
    }
    p.x = clamp(p.x, -PLAYER_LIMIT, PLAYER_LIMIT); p.z = clamp(p.z, -PLAYER_LIMIT, PLAYER_LIMIT);
    this.x = p.x; this.z = p.z;
    const moved = Math.hypot(this.x - ox, this.z - oz);
    this.speed = damp(this.speed, moved / Math.max(dt, 1e-4), 12, dt);
    this.y = damp(this.y, groundY(this.x, this.z), 14, dt);

    // ----- body orientation & animation -----
    const fpsLike = this.view === "fps" || this.aiming;
    const targetYaw = fpsLike ? this.camYaw : this.speed > 0.3 ? Math.atan2(this.vx, this.vz) : this.yaw;
    const turn = angDiff(this.yaw, targetYaw);
    this.yaw += turn * (1 - Math.exp(-(fpsLike ? 18 : 11) * dt));
    this.aim = clamp(this.aim + (this.aiming ? dt : -dt) / 0.32, 0, 1);
    const a = this.anim;
    a.speed = this.speed; a.lean = damp(a.lean, lean + clamp(turn * 0.25, -0.35, 0.35) * (this.speed > 1 ? 1 : 0), 6, dt);
    a.pose = this.aim > 0.02 ? "cameraUp" : this.gesture ? "interact" : "none";
    // look around when standing idle, follow the camera otherwise
    this.idleT = this.speed < 0.2 && !this.aiming ? this.idleT + dt : 0;
    a.looking = true;
    a.lookYaw = this.idleT > 5 ? Math.sin(this.idleT * 0.6) * 0.9 : clamp(angDiff(this.yaw, this.camYaw), -1, 1);
    a.lookPitch = this.idleT > 5 ? 0 : this.camPitch * 0.5;
    const m = this.visual.mesh;
    m.position.set(this.x, this.y, this.z); m.rotation.y = this.yaw;
    animate(this.visual, a, dt, moved);
    const sm = this.aim * this.aim * (3 - 2 * this.aim);
    this.prop.position.set(0, lerp(1.17, 1.635, sm), lerp(0.165, 0.2, sm));

    // footsteps (two per walk cycle)
    const step = Math.floor(a.phase / Math.PI);
    this.stepEvent = step !== this.lastStep && this.speed > 0.5; this.lastStep = step;

    // ----- camera -----
    const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw), sp = Math.sin(this.camPitch), cp = Math.cos(this.camPitch);
    const fx = sy * cp, fy = -sp, fz = cy * cp;
    const eyeH = 1.64 * this.visual.scale;
    this.bobPhase = a.phase * 2;
    const bob = st.headBob && this.view === "fps" && !this.aiming ? Math.sin(this.bobPhase) * 0.028 * clamp(this.speed / 2, 0, 1.6) : 0;
    this.eye.set(this.x + sy * 0.12, this.y + eyeH + bob, this.z + cy * 0.12);
    let px = this.eye.x, py = this.eye.y, pz = this.eye.z;
    const blend = this.view === "fps" ? 1 : sm;
    if (blend < 1) {
      const pvx = this.x + cy * 0.48, pvy = this.y + 1.55, pvz = this.z - sy * 0.48;
      const hit = rayBoxes(pvx, pvy, pvz, -fx, -fy, -fz, 3.5);
      const want = clamp(hit - 0.25, 0.5, 3.4);
      this.camDist = want < this.camDist ? want : damp(this.camDist, want, 4, dt);
      const tx = pvx - fx * this.camDist, ty = Math.max(pvy - fy * this.camDist, groundY(pvx - fx * this.camDist, pvz - fz * this.camDist) + 0.3), tz = pvz - fz * this.camDist;
      px = lerp(tx, px, blend); py = lerp(ty, py, blend); pz = lerp(tz, pz, blend);
    }
    this.camera.position.set(px, py, pz);
    this.camera.rotation.set(this.camPitch + this.shakePitch * this.aim, this.camYaw + this.shakeYaw * this.aim, 0);
    this.camera.fov = lerp(BASE_FOV, this.lensFov, sm);
    const show = this.view === "tps" ? sm < 0.7 : false;
    m.isVisible = show; this.prop.isVisible = show;
  }

  setView(v: "tps" | "fps") { this.view = v; }
  dispose() { this.visual.dispose(); this.prop.dispose(); this.camera.dispose(); }
}
