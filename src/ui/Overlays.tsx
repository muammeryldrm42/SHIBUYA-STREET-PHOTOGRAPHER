import { useEffect, useState } from "react";
import { ui, useUI, game, RollShot, ScoreBreakdown } from "../state/store";
import { Settings, PRESETS, QualityPreset, ACTION_LABELS, Action, DEFAULT_KEYS, keyLabel, saveSettings } from "../state/settings";
import { Gallery, QuotaError, downloadBlob, toJpeg } from "../data/gallery";
import { nav, shutterLabel, fmtComp, scoreWord } from "./util";

export function PauseMenu() {
  const roll = useUI((s) => s.roll.length), keys = useUI((s) => s.settings.keys);
  const k = (a: Action) => keyLabel(keys[a]);
  return (
    <div className="overlay dim">
      <div className="panel narrow">
        <h2>Paused</h2>
        <p className="sub">The city is frozen while this menu is open.</p>
        <div className="stack">
          <button className="btn primary" onClick={() => game.cmd?.resume()}>Resume</button>
          <button className="btn" disabled={!roll} onClick={() => game.cmd?.openOverlay("review")}>Review shots{roll ? ` (${roll})` : ""}</button>
          <button className="btn" onClick={() => { nav.fromPause = true; game.cmd?.openOverlay("gallery"); }}>Photo Gallery</button>
          <button className="btn" onClick={() => { nav.fromPause = true; game.cmd?.openOverlay("settings"); }}>Settings</button>
          <button className="btn ghost" onClick={() => { if (!ui.get().roll.some((r) => !r.saved) || confirm("You have unsaved photos in the camera roll. Leave anyway?")) game.cmd?.quitToMenu(); }}>Quit to menu</button>
        </div>
        <ul className="keys compact">
          <li><kbd>{k("forward")}{k("left")}{k("back")}{k("right")}</kbd> move · <kbd>{k("run")}</kbd> run · <kbd>{k("toggleView")}</kbd> view</li>
          <li><kbd>{k("interact")}</kbd> talk · <kbd>1–3</kbd> dialogue choice</li>
          <li><kbd>Right click</kbd>/<kbd>{k("camera")}</kbd> camera · <kbd>Click</kbd> shoot · <kbd>Wheel</kbd> zoom · <kbd>{k("focus")}</kbd> focus</li>
          <li><kbd>{k("apertureDown")}</kbd><kbd>{k("apertureUp")}</kbd> aperture · <kbd>{k("shutterDown")}</kbd><kbd>{k("shutterUp")}</kbd> shutter · <kbd>{k("isoDown")}</kbd><kbd>{k("isoUp")}</kbd> ISO</li>
          <li><kbd>{k("review")}</kbd> review shots · <kbd>{k("gallery")}</kbd> album</li>
        </ul>
      </div>
    </div>
  );
}

// ---------- Settings ----------
function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, l]) => <button key={String(v)} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
function Slider({ value, min, max, step, onChange, fmt }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return <div className="slider"><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><span className="mono">{fmt ? fmt(value) : value}</span></div>;
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="row"><div><b>{label}</b>{hint && <small>{hint}</small>}</div><div>{children}</div></div>;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const st = useUI((s) => s.settings), renderer = useUI((s) => s.renderer);
  const [tab, setTab] = useState<"graphics" | "world" | "audio" | "controls">("graphics");
  const [binding, setBinding] = useState<Action | null>(null);
  const apply = (patch: Partial<Settings>, custom = false) => {
    const next = { ...st, ...patch, ...(custom ? { preset: "custom" as QualityPreset } : {}) };
    if (game.cmd) game.cmd.applySettings(next); else { saveSettings(next); ui.set({ settings: next }); }
  };
  useEffect(() => {
    if (!binding) return;
    const on = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.code !== "Escape") apply({ keys: { ...st.keys, [binding]: e.code } });
      setBinding(null);
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [binding, st]);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="overlay dim">
      <div className="panel wide">
        <header className="panel-head"><h2>Settings</h2><button className="btn" onClick={onClose}>Done</button></header>
        <div className="tabs">{(["graphics", "world", "audio", "controls"] as const).map((t) => <button key={t} className={t === tab ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        <div className="panel-body">
          {tab === "graphics" && <>
            <Row label="Quality preset" hint="Default is picked from your hardware.">
              <Seg value={st.preset} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"], ["ultra", "Ultra"], ...(st.preset === "custom" ? [["custom", "Custom"] as [QualityPreset, string]] : [])]} onChange={(p) => { if (p !== "custom") apply({ preset: p, ...PRESETS[p] }); }} />
            </Row>
            <Row label="Resolution scale"><Slider value={st.resolutionScale} min={0.5} max={1} step={0.05} fmt={pct} onChange={(v) => apply({ resolutionScale: v }, true)} /></Row>
            <Row label="Adaptive resolution" hint="Lowers resolution automatically when the frame rate drops."><Seg value={st.adaptiveResolution ? 1 : 0} options={[[1, "On"], [0, "Off"]]} onChange={(v) => apply({ adaptiveResolution: !!v })} /></Row>
            <Row label="Shadow quality"><Seg value={st.shadows} options={[[0, "Off"], [1, "Low"], [2, "Medium"], [3, "High"]]} onChange={(v) => apply({ shadows: v as Settings["shadows"] }, true)} /></Row>
            <Row label="Crowd density"><Slider value={st.crowdDensity} min={0.5} max={1.6} step={0.05} fmt={pct} onChange={(v) => apply({ crowdDensity: v }, true)} /></Row>
            <Row label="Anti-aliasing"><Seg value={st.antialias} options={[["off", "Off"], ["fxaa", "FXAA"], ["msaa", "MSAA 4×"]]} onChange={(v) => apply({ antialias: v }, true)} /></Row>
            <Row label="Effects" hint="Bloom, ambient occlusion, depth-of-field quality."><Seg value={st.effects} options={[[0, "Minimal"], [1, "Standard"], [2, "Full"]]} onChange={(v) => apply({ effects: v as Settings["effects"] }, true)} /></Row>
            <Row label="FPS limit"><Seg value={st.fpsLimit} options={[[30, "30"], [60, "60"], [0, "Unlimited"]]} onChange={(v) => apply({ fpsLimit: v as Settings["fpsLimit"] })} /></Row>
            <Row label="Renderer" hint={`${renderer ? `Running on ${renderer}. ` : ""}Takes effect the next time you press PLAY.`}><Seg value={st.renderer} options={[["auto", "WebGPU → WebGL"], ["webgl", "WebGL only"]]} onChange={(v) => apply({ renderer: v })} /></Row>
            <Row label="Photo resolution"><Seg value={st.photoRes} options={[["720", "1280×720"], ["1080", "1920×1080"], ["1440", "2560×1440"]]} onChange={(v) => apply({ photoRes: v })} /></Row>
          </>}
          {tab === "world" && <>
            <Row label="Time of day" hint="Changes the real light your camera meters."><Seg value={st.time} options={[["morning", "Morning"], ["afternoon", "Afternoon"], ["golden", "Golden Hour"], ["night", "Night"]]} onChange={(v) => apply({ time: v })} /></Row>
            <Row label="Weather" hint="Rain wets the streets and brings out umbrellas."><Seg value={st.weather} options={[["sunny", "Sunny"], ["cloudy", "Cloudy"], ["rainy", "Rainy"]]} onChange={(v) => apply({ weather: v })} /></Row>
            <p className="note">Signal timings in this game are simulation values chosen for play, not measurements of the real crossing.</p>
          </>}
          {tab === "audio" && <>
            <Row label="Master"><Slider value={st.volMaster} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => apply({ volMaster: v })} /></Row>
            <Row label="Ambience"><Slider value={st.volAmbient} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => apply({ volAmbient: v })} /></Row>
            <Row label="Traffic"><Slider value={st.volTraffic} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => apply({ volTraffic: v })} /></Row>
            <Row label="Camera & footsteps"><Slider value={st.volSfx} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => apply({ volSfx: v })} /></Row>
            <Row label="Voices"><Slider value={st.volVoices} min={0} max={1} step={0.05} fmt={pct} onChange={(v) => apply({ volVoices: v })} /></Row>
          </>}
          {tab === "controls" && <>
            <Row label="Mouse sensitivity"><Slider value={st.sensitivity} min={0.3} max={2.5} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => apply({ sensitivity: v })} /></Row>
            <Row label="Invert vertical look"><Seg value={st.invertY ? 1 : 0} options={[[0, "Off"], [1, "On"]]} onChange={(v) => apply({ invertY: !!v })} /></Row>
            <Row label="Head bob (first person)"><Seg value={st.headBob ? 1 : 0} options={[[1, "On"], [0, "Off"]]} onChange={(v) => apply({ headBob: !!v })} /></Row>
            <Row label="Control hints"><Seg value={st.showHints ? 1 : 0} options={[[1, "Show"], [0, "Hide"]]} onChange={(v) => apply({ showHints: !!v })} /></Row>
            <div className="binds">
              {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
                <button key={a} className={binding === a ? "on" : ""} onClick={() => setBinding(a)}><span>{ACTION_LABELS[a]}</span><kbd>{binding === a ? "press a key…" : keyLabel(st.keys[a])}</kbd></button>
              ))}
            </div>
            <div className="row"><div><small>Mouse: look · left click shoot · right click camera · wheel zoom.</small></div><button className="btn" onClick={() => apply({ keys: { ...DEFAULT_KEYS } })}>Reset keys</button></div>
          </>}
        </div>
      </div>
    </div>
  );
}

// ---------- Score + photo review ----------
export function ScoreCard({ score }: { score: ScoreBreakdown | null }) {
  if (!score) return <div className="scorecard"><div className="score-total none"><b>—</b><span>Unscored</span></div><p className="note">Scored portraits need a subject who agreed to the photo and is inside the frame. You can still keep this picture.</p></div>;
  return (
    <div className="scorecard">
      <div className="score-total"><b>{score.total}</b><span>/ 100 · {scoreWord(score.total)}</span></div>
      {score.parts.map((p) => (
        <div className="score-row" key={p.key}>
          <div><span>{p.label}</span><span className="mono">{p.score}/{p.max}</span></div>
          <div className="score-bar"><i style={{ width: `${(p.score / p.max) * 100}%` }} /></div>
          <small>{p.note}</small>
        </div>
      ))}
      {score.notes.map((n, i) => <p className="note warn" key={i}>{n}</p>)}
    </div>
  );
}

export function Review() {
  const roll = useUI((s) => s.roll);
  const [sel, setSel] = useState<string | null>(roll[0]?.meta.id ?? null);
  const [busy, setBusy] = useState("");
  const shot: RollShot | undefined = roll.find((r) => r.meta.id === sel) ?? roll[0];
  useEffect(() => { if (!roll.length) game.cmd?.resume(); }, [roll.length]);
  if (!shot) return null;
  const m = shot.meta;
  const blob = () => game.cmd?.getShotBlob(m.id) ?? null;
  const save = async () => {
    const b = blob(); if (!b) return;
    setBusy("Saving…");
    try {
      const thumb = await (await fetch(shot.thumbUrl)).blob();
      await Gallery.save({ id: m.id, meta: m, blob: b, thumb, favorite: false, savedAt: Date.now() });
      game.cmd?.markSaved(m.id);
      ui.toast("Saved to your album");
    } catch (e) {
      ui.toast(e instanceof QuotaError ? e.message : "Could not save to the album. Download the photo instead.");
    }
    setBusy("");
  };
  const dl = async (jpg: boolean) => {
    const b = blob(); if (!b) return;
    setBusy("Preparing…");
    try { downloadBlob(jpg ? await toJpeg(b) : b, `${m.fileBase}.${jpg ? "jpg" : "png"}`); } catch { ui.toast("Download failed"); }
    setBusy("");
  };
  return (
    <div className="overlay dim review">
      <div className="panel full">
        <header className="panel-head">
          <h2>Photo preview</h2>
          <span className="live">● city is live — watch the signal</span>
          <button className="btn" onClick={() => game.cmd?.resume()}>Back to Game</button>
        </header>
        <div className="review-body">
          <div className="review-main">
            <img src={shot.url} alt={m.npcName ? `Portrait of ${m.npcName}` : "Street photo"} />
            <div className="exif mono">{m.width}×{m.height} · {m.focal}mm · f/{m.aperture} · {shutterLabel(m.shutter)} · ISO {m.iso} · {fmtComp(m.comp)} EV · {m.mode} · {m.time}/{m.weather}</div>
            <div className="actions">
              <button className="btn primary" disabled={shot.saved || !!busy} onClick={save}>{shot.saved ? "Saved ✓" : "Save Photo"}</button>
              <button className="btn" disabled={!!busy} onClick={() => dl(false)}>Download PNG</button>
              <button className="btn" disabled={!!busy} onClick={() => dl(true)}>Download JPG</button>
              <button className="btn" onClick={() => game.cmd?.retake(m.id)}>Retake</button>
              <button className="btn ghost" onClick={() => game.cmd?.discardShot(m.id)}>Discard</button>
              {busy && <span className="busy">{busy}</span>}
            </div>
          </div>
          <aside>
            <h3>{m.npcName ? `${m.npcName} · ${m.portraitType} portrait` : "Free shot"}</h3>
            <ScoreCard score={m.score} />
          </aside>
        </div>
        <div className="strip">
          {roll.map((r) => (
            <button key={r.meta.id} className={r.meta.id === shot.meta.id ? "on" : ""} onClick={() => setSel(r.meta.id)}>
              <img src={r.thumbUrl} alt="" />
              <span>{r.meta.score ? r.meta.score.total : "—"}{r.saved ? " ✓" : ""}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
