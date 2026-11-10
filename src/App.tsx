import { useEffect, useRef, useState } from "react";
import { ui, useUI, game } from "./state/store";
import { saveName, saveSettings, keyLabel } from "./state/settings";
import { Hud } from "./ui/Hud";
import { PauseMenu, SettingsPanel, Review } from "./ui/Overlays";
import { GalleryView } from "./ui/Gallery";
import { nav } from "./ui/util";


function Art() {
  // original illustration of a scramble crossing at night
  const win: React.ReactNode[] = [];
  const blocks = [[0, 150, 210, 330, 250], [215, 90, 150, 390, 205], [370, 190, 120, 290, 30], [1110, 180, 130, 300, 330], [1245, 110, 170, 370, 195], [1420, 160, 180, 320, 285]];
  blocks.forEach(([x, y, w, h, hue], b) => {
    for (let r = 0; r < Math.floor(h / 26); r++) for (let c = 0; c < Math.floor(w / 22); c++) {
      const on = (r * 7 + c * 13 + b * 5) % 5 < 2;
      if (on) win.push(<rect key={`${b}-${r}-${c}`} x={x + 8 + c * 22} y={y + 10 + r * 26} width={12} height={15} fill={`hsl(${(hue + (r * c) % 40)},70%,${55 + ((r + c) % 3) * 8}%)`} opacity={0.55} />);
    }
  });
  const stripes: React.ReactNode[] = [];
  for (let i = 0; i < 16; i++) { const y = 560 + i * i * 1.6 + i * 9, h = 5 + i * 1.7; stripes.push(<polygon key={i} points={`${800 - (150 + i * 46)},${y} ${800 + (150 + i * 46)},${y} ${800 + (158 + i * 49)},${y + h} ${800 - (158 + i * 49)},${y + h}`} fill="#e9e5dc" opacity={0.1 + i * 0.022} />); }
  return (
    <svg className="art" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b0c14" /><stop offset="0.6" stopColor="#1c1a2a" /><stop offset="1" stopColor="#2c2230" /></linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.55" r="0.5"><stop offset="0" stopColor="#e0a04a" stopOpacity="0.35" /><stop offset="1" stopColor="#e0a04a" stopOpacity="0" /></radialGradient>
        <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b1a1d" /><stop offset="1" stopColor="#0d0d0f" /></linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sky)" />
      {blocks.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} fill="#15151c" />)}
      {win}
      <rect x="500" y="250" width="600" height="250" fill="#11121a" />
      <rect x="560" y="280" width="480" height="170" rx="4" fill="#e0a04a" opacity="0.85" />
      <text x="800" y="385" textAnchor="middle" fontSize="74" fontWeight="900" fill="#1a1410" fontFamily="'Yu Gothic UI','Meiryo',sans-serif">交差点ビジョン</text>
      <rect x="0" y="480" width="1600" height="420" fill="url(#road)" />
      <rect x="0" y="300" width="1600" height="500" fill="url(#glow)" />
      {stripes}
    </svg>
  );
}

function Menu({ onPlay }: { onPlay: (name: string) => void }) {
  const saved = useUI((s) => s.playerName);
  const [name, setName] = useState(saved);
  const ok = name.trim().length > 0;
  return (
    <div className="menu">
      <Art />
      <div className="menu-shade" />
      <div className="menu-panel">
        <div className="logo">
          <span className="logo-mark" aria-hidden><i /></span>
          <div>
            <div className="logo-jp">渋谷ストリートフォトグラファー</div>
            <h1>SHIBUYA <b>STREET</b> PHOTOGRAPHER</h1>
          </div>
        </div>
        <p className="tagline">Walk the scramble. Ask first. Catch the moment before the light changes.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onPlay(name.trim()); }}>
          <label htmlFor="nick">Enter Your Name</label>
          <input id="nick" value={name} maxLength={18} autoFocus autoComplete="off" spellCheck={false} placeholder="Photographer name" onChange={(e) => setName(e.target.value)} />
          <button className="btn primary big" disabled={!ok} type="submit">PLAY</button>
        </form>
        <div className="menu-row">
          <button className="btn" onClick={() => { nav.fromPause = false; ui.set({ overlay: "settings" }); }}>Settings</button>
          <button className="btn" onClick={() => { nav.fromPause = false; ui.set({ overlay: "gallery" }); }}>Photo Gallery</button>
        </div>
        <p className="fine">Free · no account · your name and photos stay in this browser.</p>
      </div>
    </div>
  );
}

function Loading({ ready, onEnter }: { ready: boolean; onEnter: () => void }) {
  const l = useUI((s) => s.loading), err = useUI((s) => s.error), keys = useUI((s) => s.settings.keys);
  const pct = Math.round(l.progress * 100);
  const k = (a: keyof typeof keys) => keyLabel(keys[a]);
  return (
    <div className="loading">
      <div className="loading-card">
        <div className="loading-art"><Art /></div>
        <div className="loading-body">
          <h2>{err ? "Could not start the game" : ready ? "Shibuya is ready" : "Loading Shibuya"}</h2>
          {err ? <p className="err">{err}</p> : (
            <>
              <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
              <div className="bar-row"><span>{l.label}</span><b>{pct}%</b></div>
            </>
          )}
          <ul className="keys">
            <li><kbd>{k("forward")}{k("left")}{k("back")}{k("right")}</kbd> Move · <kbd>{k("run")}</kbd> Run · <kbd>Mouse</kbd> Look</li>
            <li><kbd>{k("interact")}</kbd> Talk to people and ask for a photo</li>
            <li><kbd>Right click</kbd> / <kbd>{k("camera")}</kbd> Raise camera · <kbd>Left click</kbd> Shoot · <kbd>Wheel</kbd> Zoom · <kbd>{k("focus")}</kbd> Focus</li>
            <li><kbd>{k("toggleView")}</kbd> First / third person · <kbd>{k("gallery")}</kbd> Album · <kbd>Esc</kbd> Menu</li>
          </ul>
          {err ? <button className="btn primary" onClick={() => ui.set({ screen: "menu", error: null })}>Back to menu</button>
            : <button className="btn primary big" disabled={!ready} onClick={onEnter}>{ready ? "ENTER SHIBUYA" : "Please wait…"}</button>}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const screen = useUI((s) => s.screen), overlay = useUI((s) => s.overlay);
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  const play = async (name: string) => {
    saveName(name); saveSettings(ui.get().settings);
    setReady(false);
    ui.set({ playerName: name, screen: "loading", error: null, overlay: null, loading: { progress: 0.01, label: "Downloading engine" } });
    try {
      const mod = await import("./game/GameEngine");
      await mod.startGame(host.current!, name);
      setReady(true);
    } catch (e) {
      ui.set({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (ui.get().roll.some((r) => !r.saved)) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const closeOverlay = () => {
    if (ui.get().screen !== "game") { ui.set({ overlay: null }); return; }
    if (nav.fromPause) game.cmd?.openOverlay("pause"); else game.cmd?.resume();
  };

  return (
    <div className="app">
      <div className="game-host" ref={host} style={{ visibility: screen === "menu" ? "hidden" : "visible" }} />
      {screen === "menu" && <Menu onPlay={play} />}
      {screen === "loading" && <Loading ready={ready} onEnter={() => game.cmd?.resume()} />}
      {screen === "game" && <Hud />}
      {screen === "game" && overlay === "pause" && <PauseMenu />}
      {overlay === "review" && <Review />}
      {overlay === "settings" && <SettingsPanel onClose={closeOverlay} />}
      {overlay === "gallery" && <GalleryView onClose={closeOverlay} />}
    </div>
  );
}
