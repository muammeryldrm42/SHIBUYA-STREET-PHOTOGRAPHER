// GameEngine: boots Babylon (WebGPU → WebGL fallback), owns the render loop and wires the systems together.
import {
  AbstractEngine, Engine, WebGPUEngine, Scene, DefaultRenderingPipeline, ImageProcessingConfiguration, ColorCurves, Color4,
  SSAO2RenderingPipeline, DepthOfFieldEffectBlurLevel, AbstractMesh,
} from "@babylonjs/core";
import { ui, game, UIState } from "../state/store";
import { Settings, saveSettings, keyLabel } from "../state/settings";
import { WorldManager } from "./world/WorldManager";
import { IntersectionController } from "./IntersectionController";
import { CrowdManager } from "./CrowdManager";
import { NPCBehaviorSystem, NPC } from "./NPCBehaviorSystem";
import { VehicleManager } from "./VehicleManager";
import { PlayerController } from "./PlayerController";
import { PhotographySystem, PhotoWorld } from "./PhotographySystem";
import { AudioManager } from "./AudioManager";
import { Input } from "./Input";
import { colliders, inScrambleZone, nearestSidewalk, onRoad, sidewalkDist } from "./world/layout";

export class GameEngine {
  engine!: AbstractEngine; scene!: Scene;
  world!: WorldManager; signal = new IntersectionController();
  crowd!: CrowdManager; behavior!: NPCBehaviorSystem; vehicles!: VehicleManager;
  player!: PlayerController; photo!: PhotographySystem; audio = new AudioManager(); input!: Input;
  pipeline!: DefaultRenderingPipeline; private ssao: SSAO2RenderingPipeline | null = null;
  canvas!: HTMLCanvasElement;
  private paused = true; private disposed = false;
  private t = 0; private last = 0; private lastRender = 0; private uiT = 0;
  private fpsAcc = 0; private fpsN = 0; private fps = 60; private dyn = 1; private dynT = 0;
  private subT = 0; private unsafeT = 0; private warnT = 0; private expectUnlock = false; private reflT = 0;
  private st: Settings;

  constructor(private container: HTMLElement) { this.st = ui.get().settings; }

  // ---------- boot ----------
  async init(name: string) {
    const prog = (p: number, label: string) => ui.set({ loading: { progress: Math.min(1, p), label } });
    prog(0.02, "Starting renderer");
    this.audio.start(this.st);
    await this.createEngine();
    const s = (this.scene = new Scene(this.engine));
    s.clearColor = new Color4(0.7, 0.8, 0.9, 1);
    s.skipPointerMovePicking = true; s.autoClear = true;
    prog(0.08, "Building Shibuya");
    this.world = new WorldManager(s);
    await this.world.build((f, l) => prog(0.08 + f * 0.5, l));

    prog(0.6, "Photographer");
    this.player = new PlayerController(s, null);
    this.player.name = name;
    this.setupPipeline();
    this.input = new Input(this.canvas, () => this.st.keys);
    this.behavior = new NPCBehaviorSystem(this.signal, {
      say: (n, text, voice) => this.say(n, text, voice),
      dialogue: (d) => { ui.set({ dialogue: d }); this.player.locked = !!d; },
      session: (x) => ui.set({ session: x }),
      playerGesture: (on) => { this.player.gesture = on; },
    }, () => this.player.info());
    this.crowd = new CrowdManager(s, this.behavior, () => this.world.shadow);
    this.vehicles = new VehicleManager(s, this.signal, () => this.world.shadow);
    this.photo = new PhotographySystem(this.engine, this.canvas, this.pipeline, this.player);
    this.photo.onSound = (k) => { if (k === "shutter") this.audio.shutter(); else if (k === "focus") this.audio.focusBeep(); else if (k === "dial") this.audio.dial(); };
    this.photo.onShot = (meta, scored) => { if (scored && meta.score) this.behavior.onPhoto(meta.score.total); };
    this.photo.onRoll = (roll) => {
      const prev = ui.get().roll[0]?.meta.id, top = roll[0];
      ui.set({ roll });
      if (top && top.meta.id !== prev && !top.saved) ui.set({ lastShot: { url: top.thumbUrl, score: top.meta.score?.total ?? null, label: top.meta.npcName ? `${top.meta.npcName} · ${top.meta.portraitType} portrait` : "Free shot — unscored (no consent)", t: Date.now() } });
    };

    this.world.setShadowQuality(this.st.shadows, [this.player.visual.mesh]);
    this.applyEnvironment();
    this.crowd.setTarget(this.st.crowdDensity);
    prog(0.64, "Crowd");
    await this.crowd.populate((f) => prog(0.64 + f * 0.24, `People on the street ${Math.round(f * 100)}%`));
    prog(0.89, "Distant crowd"); await new Promise((r) => setTimeout(r, 0));
    this.crowd.buildImpostors(Math.round(110 * Math.min(1.4, this.st.crowdDensity)));
    prog(0.92, "Traffic"); await new Promise((r) => setTimeout(r, 0));
    this.vehicles.setReflection(this.world.reflection);
    this.vehicles.seed();
    this.applyGraphics();

    this.scene.onAfterRenderObservable.add(() => this.photo.afterSceneRender());
    this.engine.onEndFrameObservable.add(() => this.photo.afterRender());
    this.input.onLockChange = (locked) => {
      ui.set({ pointerLocked: locked });
      if (!locked && !this.expectUnlock && !this.paused && ui.get().overlay === null) this.openOverlay("pause");
      this.expectUnlock = false;
    };
    this.input.onEscape = () => {
      const o = ui.get().overlay;
      if (ui.get().screen !== "game") return;
      if (o === null) this.openOverlay("pause"); else if (o === "pause" || o === "review") this.resume(); else this.openOverlay("pause");
    };
    this.canvas.addEventListener("click", () => { if (!this.paused && ui.get().overlay === null && !this.input.locked) this.input.lock(); });
    window.addEventListener("resize", this.onResize);
    this.registerCommands();

    // warm-up: compile shaders by rendering real frames before showing the game
    prog(0.94, "Compiling shaders");
    this.last = performance.now();
    this.engine.runRenderLoop(() => this.frame());
    // never hang on a background tab where animation frames are throttled
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await Promise.race([s.whenReadyAsync(), wait(6000)]);
    for (let i = 0; i < 4; i++) { await Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), wait(250)]); prog(0.95 + i * 0.012, "Compiling shaders"); }
    prog(1, "Ready");
    (window as unknown as Record<string, unknown>).__ssp = this;
  }

  private async createEngine() {
    const mk = () => {
      const c = document.createElement("canvas");
      c.className = "game-canvas"; c.tabIndex = 0;
      this.container.innerHTML = ""; this.container.appendChild(c);
      return c;
    };
    let renderer = "";
    if (this.st.renderer === "auto" && "gpu" in navigator && !sessionStorage.getItem("ssp.noWebGPU")) {
      try {
        this.canvas = mk();
        const e = new WebGPUEngine(this.canvas, { antialias: false, stencil: false, adaptToDeviceRatio: false, powerPreference: "high-performance" });
        await Promise.race([e.initAsync(), new Promise((_, rej) => setTimeout(() => rej(new Error("WebGPU init timeout")), 12000))]);
        this.engine = e; renderer = "WebGPU";
      } catch (err) { console.warn("WebGPU unavailable, falling back to WebGL", err); renderer = ""; }
    }
    if (!renderer) {
      this.canvas = mk();
      this.engine = new Engine(this.canvas, false, { stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false, adaptToDeviceRatio: false });
      renderer = `WebGL${(this.engine as Engine).webGLVersion}`;
    }
    ui.set({ renderer });
  }

  private setupPipeline() {
    const p = (this.pipeline = new DefaultRenderingPipeline("main", true, this.scene, [this.player.camera]));
    const ip = p.imageProcessing;
    ip.toneMappingEnabled = true; ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.contrast = 1.14; ip.exposure = 1;
    ip.vignetteEnabled = false; ip.vignetteColor = new Color4(0, 0, 0, 0); ip.vignetteWeight = 1.2; ip.vignetteStretch = 0.2;
    const cc = new ColorCurves(); cc.globalSaturation = 18; cc.highlightsHue = 35; cc.highlightsDensity = 12; cc.shadowsHue = 220; cc.shadowsDensity = 10;
    ip.colorCurves = cc; ip.colorCurvesEnabled = true;
    p.bloomThreshold = 0.78; p.bloomWeight = 0.3; p.bloomKernel = 72; p.bloomScale = 0.5;
  }

  // ---------- settings ----------
  private applyGraphics() {
    const st = this.st, p = this.pipeline;
    this.engine.setHardwareScalingLevel(1 / (st.resolutionScale * this.dyn * (st.preset === "ultra" ? Math.min(window.devicePixelRatio || 1, 1.5) : 1)));
    p.bloomEnabled = st.effects >= 1;
    p.fxaaEnabled = st.antialias === "fxaa";
    p.samples = st.antialias === "msaa" ? 4 : 1;
    this.photo.dofLevel = st.effects === 2 ? DepthOfFieldEffectBlurLevel.Medium : DepthOfFieldEffectBlurLevel.Low;
    this.photo.resolution = st.photoRes;
    const casters: AbstractMesh[] = [this.player.visual.mesh, ...this.crowd.npcs.map((n) => n.visual.mesh)];
    this.world.setShadowQuality(st.shadows, casters);
    if (st.effects === 2 && !this.ssao) {
      try {
        const ao = new SSAO2RenderingPipeline("ssao", this.scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [this.player.camera]);
        ao.radius = 1.4; ao.totalStrength = 0.9; ao.samples = 10; ao.expensiveBlur = false; ao.maxZ = 120; ao.minZAspect = 0.4;
        this.ssao = ao;
      } catch (e) { console.warn("Ambient occlusion unavailable", e); }
    } else if (st.effects < 2 && this.ssao) { this.ssao.dispose(); this.ssao = null; }
    this.crowd.setTarget(st.crowdDensity);
    this.vehicles.maxPerLane = st.crowdDensity < 0.7 ? 2 : 3;
    this.audio.applyVolumes(st);
    this.engine.resize();
  }
  private applyEnvironment() {
    const st = this.st;
    this.world.setEnvironment(st.time, st.weather, st.effects);
    this.crowd?.setRain(st.weather === "rainy");
    this.audio.setWeather(st.weather === "rainy", st.time === "night");
  }
  applySettings(next: Settings) {
    const prev = this.st;
    this.st = next; saveSettings(next); ui.set({ settings: next });
    this.applyGraphics();
    if (prev.time !== next.time || prev.weather !== next.weather || prev.effects !== next.effects) this.applyEnvironment();
  }

  // ---------- UI bridge ----------
  private registerCommands() {
    game.cmd = {
      resume: () => this.resume(),
      pause: () => this.openOverlay("pause"),
      openOverlay: (o) => this.openOverlay(o),
      applySettings: (s) => this.applySettings(s),
      chooseDialogue: (i) => this.behavior.choose(i),
      quitToMenu: () => this.dispose(),
      discardShot: (id) => this.photo.discard(id),
      markSaved: (id) => this.photo.markSaved(id),
      getShotBlob: (id) => this.photo.getShot(id)?.blob ?? null,
      requestPointerLock: () => this.input.lock(),
      shutter: () => { this.input.clickL = true; },
      toggleCamera: () => { if (!this.player.forced && !ui.get().dialogue) this.setAiming(!this.player.aiming); },
      retake: (id) => { this.photo.discard(id); this.resume(); if (!this.player.aiming) this.setAiming(true); },
    };
  }
  /** Start (or continue) play. Must be called from a user gesture so pointer lock and audio are allowed. */
  resume() {
    ui.set({ overlay: null, screen: "game" });
    this.paused = false; this.last = performance.now();
    this.audio.setPaused(false);
    this.input.enabled = true; this.input.reset();
    this.input.lock();
    this.canvas.focus();
  }
  openOverlay(o: UIState["overlay"]) {
    if (o === null) { this.resume(); return; }
    // the quick review keeps the city alive; pause, settings and the album stop the simulation
    const live = o === "review";
    this.paused = !live;
    this.audio.setPaused(!live);
    this.input.enabled = false; this.input.reset();
    if (this.input.locked) { this.expectUnlock = true; this.input.unlock(); }
    ui.set({ overlay: o });
  }

  private say(n: NPC, text: string, voice?: "greet" | "surprise" | "laugh") {
    if (text) { ui.set({ subtitle: { who: n.name, text } }); this.subT = 2.2 + text.length * 0.045; }
    const d = Math.hypot(n.x - this.player.x, n.z - this.player.z);
    if (d < 26) this.audio.voice(n.x, n.z, voice ?? "talk", n.look.female, n.id);
  }

  private setAiming(on: boolean) {
    if (this.player.aiming === on) return;
    this.player.aiming = on;
    this.audio.cameraMove(on);
  }

  // ---------- frame ----------
  private onResize = () => { if (!this.photo?.capturing) this.engine.resize(); };

  private frame() {
    if (this.disposed) return;
    const now = performance.now();
    const limit = this.st.fpsLimit;
    if (limit && now - this.lastRender < 1000 / limit - 1.5) return;
    this.lastRender = now;
    const raw = (now - this.last) / 1000; this.last = now;
    const dt = Math.min(raw, 0.05);
    if (!this.paused) this.simulate(dt);
    this.photo.beforeRender();
    this.scene.render();
    // fps + adaptive resolution
    this.fpsAcc += raw; this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
      if (this.st.adaptiveResolution && !this.paused) {
        this.dynT += 0.5;
        if (this.dynT > 2.5) {
          const target = limit === 30 ? 26 : 38;
          if (this.fps < target && this.dyn > 0.55) { this.dyn = Math.max(0.55, this.dyn - 0.1); this.applyScale(); this.dynT = 0; }
          else if (this.fps > (limit === 30 ? 29.5 : 57) && this.dyn < 1) { this.dyn = Math.min(1, this.dyn + 0.05); this.applyScale(); this.dynT = 1; }
        }
      }
    }
  }
  private applyScale() {
    if (this.photo.capturing) return;
    this.engine.setHardwareScalingLevel(1 / (this.st.resolutionScale * this.dyn * (this.st.preset === "ultra" ? Math.min(window.devicePixelRatio || 1, 1.5) : 1)));
  }

  private simulate(dt: number) {
    this.t += dt;
    const { player: pl, input, signal, crowd, behavior, photo } = this;
    const state = ui.get();

    // ----- input actions -----
    if (state.dialogue) {
      for (let i = 0; i < 3; i++) if (input.hitCode("Digit" + (i + 1)) || input.hitCode("Numpad" + (i + 1))) behavior.choose(i);
      if (pl.aiming) this.setAiming(false);
    } else {
      if (input.hit("toggleView")) { pl.setView(pl.view === "tps" ? "fps" : "tps"); ui.set({ viewMode: pl.view }); }
      if ((input.hit("camera") || input.clickR) && !pl.forced) this.setAiming(!pl.aiming);
      if (input.hit("gallery")) { this.openOverlay("gallery"); return; }
      if (input.hit("review") && state.roll.length) { this.openOverlay("review"); return; }
    }

    // ----- road safety: the signal always wins over photography -----
    const pOnRoad = onRoad(pl.x, pl.z);
    const pedOK = signal.phase === "PED_GREEN" || signal.phase === "PED_WARNING";
    let warning: string | null = null;
    if (pOnRoad && signal.phase === "PED_WARNING") {
      warning = "Pedestrian signal ending — Clear the crossing!";
      this.warnT -= dt; if (this.warnT <= 0) { this.audio.warn(); this.warnT = 1.4; }
    } else if (pOnRoad && !pedOK) {
      warning = "Signal is red — moving to the sidewalk";
      this.unsafeT += dt;
      if (pl.aiming) { this.setAiming(false); ui.toast("Shoot interrupted — the pedestrian signal ended"); }
      if (this.unsafeT > 0.5 && !pl.forced) pl.forced = nearestSidewalk(pl.x, pl.z);
    } else { this.unsafeT = 0; this.warnT = 0; }
    if (pl.forced && sidewalkDist(pl.x, pl.z) > 0.7) pl.forced = null;
    if (!warning && !pOnRoad && behavior.sessionNpc?.session?.type === "walk" && signal.phase === "PED_WARNING" && onRoad(behavior.sessionNpc.x, behavior.sessionNpc.z)) warning = "Signal ending — your subject is hurrying across";

    // ----- world systems -----
    signal.update(dt, { peopleOnCrossing: crowd.peopleOnCrossing() || inScrambleZone(pl.x, pl.z), vehiclesInJunction: this.vehicles.vehiclesInJunction() });
    const people = pOnRoad ? [...crowd.onRoadPeople, { x: pl.x, z: pl.z }] : crowd.onRoadPeople;
    this.vehicles.update(dt, people);
    const boxes = this.vehicles.boxes();
    pl.update(dt, input, this.st, { boxes, people: crowd.npcs });
    crowd.update(dt, pl.info(), pl.camera);
    behavior.tick(dt);

    // interaction prompt
    let prompt: string | null = null;
    if (!state.dialogue && !pl.aiming && !pOnRoad) {
      const near = crowd.nearest(pl.info());
      const pr = near ? behavior.promptFor(near) : null;
      if (pr) {
        prompt = pr.can ? `${keyLabel(this.st.keys.interact)} — ${pr.text}${pr.text === "Interact" ? ` with ${(near!.leader ?? near!).name}` : ""}` : pr.text;
        if (pr.can && input.hit("interact")) behavior.interact(near!);
      }
    }

    const pw: PhotoWorld = {
      npcs: crowd.npcs, subject: behavior.sessionNpc, vehicleBoxes: boxes, light: this.world.light,
      unsafe: pOnRoad && !pedOK, time: this.st.time, weather: this.st.weather,
    };
    photo.update(dt, input, pw, pl.speed);
    this.world.update(dt, this.t, pl.camera.position, pl.x, pl.z);
    this.world.applySignals(signal, this.t);
    if (this.world.night || this.world.wet) { this.reflT += dt; if (this.reflT > 2.5) { this.reflT = 0; this.world.refreshReflections(); } }
    if (pl.stepEvent && !pl.aiming) this.audio.footstep(this.world.wet, pl.speed > 3);
    else if (pl.stepEvent) this.audio.footstep(this.world.wet, false);

    // audio listener
    const c = pl.camera, cy = c.rotation.y, cp = c.rotation.x;
    let near = 0; for (const n of crowd.npcs) if (n.dist < 16) near++;
    this.audio.update(dt, { x: c.position.x, y: c.position.y, z: c.position.z, fx: Math.sin(cy) * Math.cos(cp), fy: -Math.sin(cp), fz: Math.cos(cy) * Math.cos(cp) }, near, this.vehicles.list, signal.ped, this.world.train);

    // ----- UI -----
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) ui.set({ subtitle: null }); }
    this.uiT -= dt;
    const camOn = pl.aim > 0.5;
    if (this.uiT <= 0 || prompt !== state.prompt || warning !== state.warning || camOn !== !!state.camera) {
      this.uiT = 0.1;
      ui.set({
        prompt, warning, fps: Math.round(this.fps),
        signal: { ped: signal.ped, label: signal.label(), timeLeft: Math.ceil(signal.ped === "red" ? signal.timeToPedGreen : signal.pedTimeLeft), veh: signal.vehNS !== "red" ? "N–S traffic" : signal.vehEW !== "red" ? "E–W traffic" : "" },
        camera: camOn ? photo.hud(pw) : null,
      });
    }
    input.endFrame();
  }

  /** Test hook: advance the simulation without waiting for animation frames, then draw one frame. */
  debugAdvance(seconds: number, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) { if (!this.paused) this.simulate(step); }
    this.engine.beginFrame(); this.photo.beforeRender(); this.scene.render(); this.engine.endFrame();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    game.cmd = null;
    window.removeEventListener("resize", this.onResize);
    this.input?.unlock(); this.input?.dispose();
    this.audio.dispose();
    try { this.engine.stopRenderLoop(); this.scene.dispose(); this.engine.dispose(); } catch (e) { console.warn(e); }
    this.container.innerHTML = "";
    colliders.boxes.length = 0; colliders.circles.length = 0;
    ui.set({ screen: "menu", overlay: null, dialogue: null, camera: null, prompt: null, warning: null, subtitle: null, session: null, roll: [], lastShot: null });
  }
}

/** Entry point used by the UI (loaded lazily so the menu appears instantly). */
export async function startGame(container: HTMLElement, name: string): Promise<GameEngine> {
  const g = new GameEngine(container);
  try {
    await g.init(name);
    return g;
  } catch (e) {
    console.error(e);
    g.dispose();
    throw e;
  }
}
