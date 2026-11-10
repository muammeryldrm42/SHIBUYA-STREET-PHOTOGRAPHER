import { useEffect, useState } from "react";
import { useUI, game, CameraHud } from "../state/store";
import { keyLabel } from "../state/settings";
import { shutterLabel, fmtComp, scoreWord } from "./util";

function SignalChip() {
  const s = useUI((x) => x.signal);
  return (
    <div className={`chip signal ${s.ped}`}>
      <span className="ped-dot" />
      <b>{s.label}</b>
      <span className="mono">{s.timeLeft}s</span>
      {s.veh && <em>{s.veh}</em>}
    </div>
  );
}

function Viewfinder({ c }: { c: CameraHud }) {
  const warning = useUI((s) => s.warning), last = useUI((s) => s.lastShot);
  const [flash, setFlash] = useState(0);
  useEffect(() => { if (last) { setFlash(last.t); const t = setTimeout(() => setFlash(0), 160); return () => clearTimeout(t); } }, [last?.t]);
  const zoom = Math.log(c.focal / 24) / Math.log(200 / 24);
  const meterPos = 50 + (Math.max(-3, Math.min(3, c.meter)) / 3) * 50;
  return (
    <div className="vf">
      <div className="vf-frame">
        <i className="br tl" /><i className="br tr" /><i className="br bl" /><i className="br brr" />
        {c.grid && <div className="thirds"><i /><i /><i /><i /></div>}
        <div className={`focus-rect ${c.focusLocked ? "locked" : ""}`}><span /></div>
        {flash > 0 && <div className="shutter-flash" />}
        <div className="vf-top">
          <span className="tag amber">{c.mode}</span>
          <span className="tag">{c.af}</span>
          {c.subject && <span className={`tag ${c.subjectInFrame ? "ok" : "dim"}`}>{c.subjectInFrame ? "●" : "○"} {c.subject}</span>}
          {c.blurRisk && <span className="tag warn">BLUR RISK</span>}
          <span className="sp" />
          <span className="mono">{String(c.shots).padStart(4, "0")}</span>
          <span className="battery" title="Battery"><i style={{ width: `${Math.round(c.battery * 100)}%` }} /></span>
        </div>
        {warning && <div className="vf-warn">⚠ {warning}</div>}
        <div className="vf-bottom">
          <div className="cell"><small>SHUTTER</small><b className="mono">{shutterLabel(c.shutter)}</b></div>
          <div className="cell"><small>APERTURE</small><b className="mono">f/{c.aperture}</b></div>
          <div className="cell"><small>ISO</small><b className="mono">{c.iso}</b></div>
          <div className="cell wide">
            <small>EXPOSURE {fmtComp(c.meter)} EV{c.comp ? ` · comp ${fmtComp(c.comp)}` : ""}</small>
            <div className="meter"><span className="m3">−3</span><i className="zero" /><i className="needle" style={{ left: `${meterPos}%` }} /><span className="p3">+3</span></div>
          </div>
          <div className="cell"><small>FOCUS</small><b className="mono">{c.focusDist > 60 ? "∞" : `${c.focusDist.toFixed(1)}m`}</b></div>
          <div className="cell wide">
            <small>ZOOM {c.focal}mm</small>
            <div className="zoombar"><i style={{ width: `${Math.round(zoom * 100)}%` }} /></div>
          </div>
        </div>
      </div>
      <button className="shutter-btn" aria-label="Take photo" onClick={() => game.cmd?.shutter()}><i /></button>
    </div>
  );
}

function Hints({ camera }: { camera: boolean }) {
  const keys = useUI((s) => s.settings.keys), show = useUI((s) => s.settings.showHints);
  if (!show) return null;
  const k = (a: keyof typeof keys) => keyLabel(keys[a]);
  return (
    <div className="hints">
      {camera ? (
        <>
          <span><kbd>Click</kbd> shoot</span><span><kbd>Wheel</kbd> zoom</span><span><kbd>{k("focus")}</kbd> focus</span>
          <span><kbd>{k("apertureDown")}</kbd><kbd>{k("apertureUp")}</kbd> aperture</span><span><kbd>{k("compDown")}</kbd><kbd>{k("compUp")}</kbd> exposure</span>
          <span><kbd>{k("shootMode")}</kbd> mode</span><span><kbd>{k("afMode")}</kbd> AF/MF</span><span><kbd>{k("camera")}</kbd> lower</span>
        </>
      ) : (
        <>
          <span><kbd>{k("forward")}{k("left")}{k("back")}{k("right")}</kbd> move</span><span><kbd>{k("run")}</kbd> run</span><span><kbd>{k("interact")}</kbd> talk</span>
          <span><kbd>{k("camera")}</kbd> camera</span><span><kbd>{k("toggleView")}</kbd> view</span><span><kbd>{k("gallery")}</kbd> album</span>
        </>
      )}
    </div>
  );
}

export function Hud() {
  const camera = useUI((s) => s.camera), prompt = useUI((s) => s.prompt), warning = useUI((s) => s.warning);
  const subtitle = useUI((s) => s.subtitle), dialogue = useUI((s) => s.dialogue), session = useUI((s) => s.session);
  const last = useUI((s) => s.lastShot), toast = useUI((s) => s.toast), overlay = useUI((s) => s.overlay);
  const locked = useUI((s) => s.pointerLocked), fps = useUI((s) => s.fps), renderer = useUI((s) => s.renderer), view = useUI((s) => s.viewMode);
  const rollN = useUI((s) => s.roll.filter((r) => !r.saved).length), reviewKey = useUI((s) => keyLabel(s.settings.keys.review));
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  if (overlay && overlay !== "review") return null;
  const showLast = last && now - last.t < 6000;
  const showToast = toast && now - toast.t < 3500;
  return (
    <div className={`hud ${camera ? "cam" : ""}`}>
      {camera && <Viewfinder c={camera} />}
      <div className="hud-tl">
        <SignalChip />
        {session && <div className="chip session"><b>{session.npcName}</b><span>{session.type}</span><small>{session.hint}</small></div>}
      </div>
      <div className="hud-tr"><span>{view === "tps" ? "3rd person" : "1st person"}</span><span className="mono">{fps} fps</span><span>{renderer}</span></div>
      {!camera && warning && <div className="warning">⚠ {warning}</div>}
      {!camera && !dialogue && <div className="crosshair" />}
      <div className="hud-bc">
        {subtitle && !dialogue && <div className="subtitle"><b>{subtitle.who}</b> {subtitle.text}</div>}
        {prompt && !dialogue && <div className="prompt">{prompt}</div>}
        {!locked && !dialogue && !overlay && <div className="lockhint">Click the scene to capture the mouse · or drag to look around</div>}
      </div>
      {dialogue && (
        <div className="dialogue">
          <header><b>{dialogue.npcName}</b><span>{dialogue.tag}</span></header>
          {dialogue.lines.map((l, i) => <p key={i} className={i === 0 ? "me" : "npc"}><em>{l.who}</em>{l.text}</p>)}
          {dialogue.choices.length === 0 ? <p className="dots">…</p> : (
            <div className="choices">{dialogue.choices.map((c, i) => <button key={i} onClick={() => game.cmd?.chooseDialogue(i)}><kbd>{i + 1}</kbd>{c.label}</button>)}</div>
          )}
        </div>
      )}
      {showLast && (
        <button className="lastshot" onClick={() => game.cmd?.openOverlay("review")}>
          <img src={last.url} alt="Last photo" />
          <div>
            <b>{last.score === null ? "Saved to roll" : `${last.score} / 100 · ${scoreWord(last.score)}`}</b>
            <small>{last.label}</small>
            <small><kbd>{reviewKey}</kbd> review · save · download</small>
          </div>
        </button>
      )}
      {!showLast && rollN > 0 && !camera && <div className="rollchip"><kbd>{reviewKey}</kbd> {rollN} unsaved {rollN === 1 ? "photo" : "photos"}</div>}
      {showToast && <div className="toast">{toast.text}</div>}
      <Hints camera={!!camera} />
    </div>
  );
}
