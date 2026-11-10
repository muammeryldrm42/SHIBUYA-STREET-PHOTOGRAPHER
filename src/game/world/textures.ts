// Procedural textures: surfaces, building facades, original Japanese-style signage, animated ad screens.
import { DynamicTexture, Scene, Texture } from "@babylonjs/core";
import { mulberry } from "./layout";

const JP = `"Yu Gothic UI","Yu Gothic","Meiryo","Hiragino Sans","Noto Sans JP","MS PGothic",sans-serif`;
export type Rect = [number, number, number, number]; // u0, v0, u1, v1

function make(scene: Scene, name: string, w: number, h: number, mip = true): { tex: DynamicTexture; g: CanvasRenderingContext2D } {
  const tex = new DynamicTexture(name, { width: w, height: h }, scene, mip, mip ? Texture.TRILINEAR_SAMPLINGMODE : Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE; tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  return { tex, g: tex.getContext() as unknown as CanvasRenderingContext2D };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, seed: number, speck = 0) {
  const img = g.createImageData(w, h), d = img.data, r = mulberry(seed);
  for (let i = 0; i < d.length; i += 4) {
    let n = (r() - 0.5) * amp;
    if (speck && r() < speck) n += (r() - 0.3) * amp * 4;
    d[i] = base[0] + n; d[i + 1] = base[1] + n; d[i + 2] = base[2] + n; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

export function asphaltTex(scene: Scene) {
  const { tex, g } = make(scene, "asphalt", 512, 512);
  noise(g, 512, 512, [52, 53, 56], 22, 11, 0.03);
  const r = mulberry(5);
  g.globalAlpha = 0.07;
  for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? "#000" : "#888"; g.beginPath(); g.ellipse(r() * 512, r() * 512, 20 + r() * 70, 8 + r() * 30, r() * 3, 0, 7); g.fill(); }
  g.globalAlpha = 1; tex.update();
  return tex;
}

export function paverTex(scene: Scene, plaza = false) {
  const { tex, g } = make(scene, plaza ? "plazaPaver" : "paver", 512, 512);
  noise(g, 512, 512, plaza ? [168, 160, 150] : [142, 140, 136], 14, plaza ? 31 : 21);
  const r = mulberry(8), n = plaza ? 4 : 8, s = 512 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,255,255"},${r() * 0.07})`;
    g.fillRect(x * s, y * s, s, s);
  }
  g.strokeStyle = "rgba(40,40,40,0.55)"; g.lineWidth = 2;
  for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke(); }
  tex.update();
  return tex;
}

/** Roughness (G) map for wet ground: glossy puddles on a damp surface. */
export function puddleTex(scene: Scene) {
  const { tex, g } = make(scene, "puddles", 512, 512);
  g.fillStyle = "rgb(0,96,0)"; g.fillRect(0, 0, 512, 512);
  const r = mulberry(77);
  for (let i = 0; i < 46; i++) {
    const x = r() * 512, y = r() * 512, rx = 18 + r() * 60, ry = 10 + r() * 40, a = r() * 3;
    for (const [ox, oy] of [[0, 0], [512, 0], [-512, 0], [0, 512], [0, -512]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, Math.max(rx, ry));
      gr.addColorStop(0, "rgba(0,10,0,1)"); gr.addColorStop(0.7, "rgba(0,14,0,0.9)"); gr.addColorStop(1, "rgba(0,96,0,0)");
      g.fillStyle = gr; g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, a, 0, 7); g.fill();
    }
  }
  tex.update();
  return tex;
}

/** Facade tile (12 m x 12 m): returns albedo + emissive (lit windows at night). */
export function facadeTex(scene: Scene, style: number) {
  const S = 512;
  const A = make(scene, "facade" + style, S, S), E = make(scene, "facadeEm" + style, S, S);
  const g = A.g, e = E.g, r = mulberry(100 + style * 17);
  e.fillStyle = "#000"; e.fillRect(0, 0, S, S);
  const win = (x: number, y: number, w: number, h: number, glass: string, lit = 0.42) => {
    g.fillStyle = glass; g.fillRect(x, y, w, h);
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, "rgba(255,255,255,0.16)"); gr.addColorStop(0.5, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    if (r() < lit) {
      const warm = r() < 0.6; const k = 0.45 + r() * 0.55;
      e.fillStyle = warm ? `rgba(255,${200 + r() * 30},${140 + r() * 40},${k})` : `rgba(${190 + r() * 40},${220 + r() * 30},255,${k})`;
      e.fillRect(x, y, w, h);
      if (r() < 0.5) { e.fillStyle = "rgba(0,0,0,0.35)"; e.fillRect(x, y + h * 0.55, w, h * 0.45); } // blinds / furniture silhouette
    }
  };
  if (style === 0) { // glass curtain wall
    g.fillStyle = "#2b3640"; g.fillRect(0, 0, S, S);
    const cols = 8, rows = 3, cw = S / cols, rh = S / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const t = 38 + r() * 20; win(x * cw + 2, y * rh + 3, cw - 4, rh - 22, `rgb(${t},${t + 16},${t + 30})`, 0.5);
      g.fillStyle = "#1c2228"; g.fillRect(x * cw + 2, y * rh + rh - 19, cw - 4, 17);
    }
  } else if (style === 1) { // concrete, punched windows
    noise(g, S, S, [188, 184, 176], 12, 3);
    const cols = 4, rows = 4, cw = S / cols, rh = S / rows;
    for (let y = 0; y < rows; y++) { g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, y * rh, S, 3);
      for (let x = 0; x < cols; x++) { g.fillStyle = "#77736c"; g.fillRect(x * cw + 22, y * rh + 24, cw - 44, rh - 50); win(x * cw + 27, y * rh + 29, cw - 54, rh - 60, "#34424e"); g.fillStyle = "#8c8880"; g.fillRect(x * cw + cw / 2 - 2, y * rh + 29, 4, rh - 60); } }
  } else if (style === 2) { // tile with ribbon windows
    noise(g, S, S, [176, 150, 122], 10, 4);
    g.strokeStyle = "rgba(60,40,30,0.25)"; g.lineWidth = 1;
    for (let i = 0; i < S; i += 16) { g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
    const rows = 4, rh = S / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < 6; x++) win(x * (S / 6) + 3, y * rh + 30, S / 6 - 6, rh - 62, "#2e3a44", 0.5);
  } else if (style === 3) { // dark metal panels, slot windows
    noise(g, S, S, [56, 58, 64], 8, 6);
    const cols = 8, rows = 3, cw = S / cols, rh = S / rows;
    g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 2;
    for (let x = 0; x <= cols; x++) { g.beginPath(); g.moveTo(x * cw, 0); g.lineTo(x * cw, S); g.stroke(); }
    for (let y = 0; y < rows; y++) { g.beginPath(); g.moveTo(0, y * rh); g.lineTo(S, y * rh); g.stroke(); for (let x = 0; x < cols; x++) if ((x + y) % 2 === 0) win(x * cw + 14, y * rh + 22, cw - 28, rh - 44, "#202a33", 0.5); }
  } else { // white modern, large squares
    noise(g, S, S, [226, 224, 218], 8, 9);
    const cols = 3, rows = 3, cw = S / cols, rh = S / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { g.fillStyle = "#555a60"; g.fillRect(x * cw + 20, y * rh + 26, cw - 40, rh - 56); win(x * cw + 25, y * rh + 31, cw - 50, rh - 66, "#3a4a58", 0.5); }
  }
  // weathering streaks
  g.globalAlpha = 0.05; for (let i = 0; i < 30; i++) { g.fillStyle = "#000"; g.fillRect(r() * S, 0, 2 + r() * 6, S); } g.globalAlpha = 1;
  A.tex.update(); E.tex.update();
  return { albedo: A.tex, emissive: E.tex };
}

/** Ground-floor shop windows (tile is 12 m x 4 m). */
export function shopfrontTex(scene: Scene) {
  const W = 1024, H = 256;
  const { tex, g } = make(scene, "shopfront", W, H);
  const r = mulberry(55);
  g.fillStyle = "#1a1c20"; g.fillRect(0, 0, W, H);
  const bays = 4, bw = W / bays;
  for (let b = 0; b < bays; b++) {
    const x = b * bw + 8, w = bw - 16;
    const hue = [38, 200, 330, 50][b];
    const gr = g.createLinearGradient(0, 30, 0, H);
    gr.addColorStop(0, `hsl(${hue},55%,${72 - b * 4}%)`); gr.addColorStop(1, `hsl(${hue},35%,38%)`);
    g.fillStyle = gr; g.fillRect(x, 34, w, H - 54);
    // interior: shelves, mannequins, a door
    g.fillStyle = "rgba(30,25,20,0.55)";
    if (b % 2 === 0) for (let i = 0; i < 4; i++) { const mx = x + 26 + i * (w - 50) / 3.6; g.beginPath(); g.arc(mx, 92, 9, 0, 7); g.fill(); g.fillRect(mx - 12, 102, 24, 62); g.fillRect(mx - 9, 164, 7, 46); g.fillRect(mx + 2, 164, 7, 46); }
    else for (let s = 0; s < 4; s++) { g.fillRect(x + 10, 60 + s * 38, w - 20, 5); for (let i = 0; i < 14; i++) { g.fillStyle = `hsla(${r() * 360},60%,${40 + r() * 30}%,0.8)`; g.fillRect(x + 14 + i * (w - 30) / 14, 60 + s * 38 - 20 - r() * 6, (w - 30) / 14 - 3, 20 + r() * 6); } g.fillStyle = "rgba(30,25,20,0.55)"; }
    g.fillStyle = "#101113"; g.fillRect(x - 8, 0, 8, H); g.fillRect(x + w, 0, 8, H); g.fillRect(x + w / 2 - 2, 34, 4, H - 54);
    g.fillStyle = "#26282c"; g.fillRect(x, H - 20, w, 20);
    g.fillStyle = `hsl(${hue},60%,30%)`; g.fillRect(x - 8, 0, bw, 30); // awning
    g.fillStyle = "rgba(255,255,255,0.08)"; g.beginPath(); g.moveTo(x, 34); g.lineTo(x + w * 0.4, 34); g.lineTo(x + w * 0.15, H - 20); g.lineTo(x, H - 20); g.fill();
  }
  tex.update();
  return tex;
}

// ---------- Signage atlas ----------
const BRANDS_H: [string, string, string, string][] = [
  ["カラオケ 歌の森", "KARAOKE UTANOMORI", "#e8322a", "#fff"], ["ラーメン 麺道場", "RAMEN MENDOJO", "#f6c21c", "#1a1a1a"], ["さくら薬局", "SAKURA DRUG", "#f2f2f2", "#d3317a"], ["ミライ電機", "MIRAI DENKI", "#0e4fb5", "#fff"],
  ["KUMO COFFEE", "クモ コーヒー", "#2f2a26", "#f1e5d0"], ["居酒屋 月あかり", "IZAKAYA TSUKIAKARI", "#231815", "#f3d9a4"], ["ゲーム PIXEL館", "GAME CENTER", "#7b2fd0", "#ffe94a"], ["回転寿司 海流", "SUSHI KAIRYU", "#fff", "#11325c"],
  ["まんが喫茶 よむよむ", "MANGA CAFE 24H", "#1c9b62", "#fff"], ["BOOKS 文星堂", "BUNSEIDO", "#f5f1e6", "#7a1f1f"], ["SORA MOBILE", "ソラ モバイル", "#19b6e6", "#fff"], ["古着 RETRO JAM", "USED CLOTHING", "#f4a31b", "#3a1c08"],
  ["焼肉 炎や", "YAKINIKU HONOYA", "#b8160f", "#ffd9a0"], ["タピオカ 茶々丸", "BUBBLE TEA", "#f7c6d7", "#5a2a3a"], ["カメラのヒカリ", "HIKARI CAMERA", "#111", "#ffd23c"], ["100円 まるとく", "MARUTOKU 100YEN", "#ffe600", "#d3121b"],
  ["渋谷センター街", "SHIBUYA CENTER-GAI", "#c5161d", "#fff"], ["渋谷駅 ハチ公口", "Shibuya Sta. Hachiko Exit", "#1c7a3d", "#fff"], ["渋谷駅前", "Shibuya Sta.", "#1657a8", "#fff"], ["道玄坂", "Dogenzaka", "#1657a8", "#fff"],
  ["ドラッグ ミドリ", "MIDORI PHARMACY", "#17a34a", "#fff"], ["洋服 ハナビ", "HANABI APPAREL", "#101820", "#ff5fa2"], ["たこ焼き 八ちゃん", "TAKOYAKI", "#d9261c", "#fff3c4"], ["地下鉄 のりば", "Subway", "#f2f2f2", "#1657a8"],
];
const BRANDS_V: [string, string, string][] = [
  ["カラオケ", "#e8322a", "#fff"], ["居酒屋", "#231815", "#f3d9a4"], ["ラーメン", "#f6c21c", "#1a1a1a"], ["漫画喫茶", "#1c9b62", "#fff"], ["焼肉", "#b8160f", "#ffd9a0"], ["薬", "#fff", "#17a34a"],
  ["ゲーム", "#7b2fd0", "#ffe94a"], ["寿司", "#fff", "#11325c"], ["美容室", "#f7c6d7", "#5a2a3a"], ["古着", "#f4a31b", "#3a1c08"], ["英会話", "#0e4fb5", "#fff"], ["ネイル", "#ff5fa2", "#fff"],
  ["貸会議室", "#f2f2f2", "#222"], ["歯科", "#19b6e6", "#fff"], ["VEND", "#d9261c", "#fff"], ["VEND", "#1657a8", "#fff"],
];
const BILLBOARDS: [string, string, string, number][] = [
  ["新発売", "AOZORA SODA", "あおぞらソーダ", 195], ["この冬、会いにいく。", "KITA RAIL PASS", "北の旅", 215], ["NEW ALBUM", "HOSHIZORA", "星空ステップ", 290], ["大感謝祭", "MIRAI DENKI", "最大50%OFF", 4],
  ["秋の新作", "HANABI APPAREL", "ハナビ コレクション", 335], ["映画", "KOSATEN NO YORU", "交差点の夜 — 近日公開", 28], ["毎日フレッシュ", "MIDORI JUICE", "みどりの野菜", 130], ["TOKYO", "NEON MARATHON", "参加者募集中", 265],
];

export interface SignAtlas { tex: DynamicTexture; horiz: Rect[]; vert: Rect[]; bill: Rect[]; vend: Rect[]; named: Record<string, Rect> }
export function signAtlas(scene: Scene): SignAtlas {
  const S = 2048;
  const { tex, g } = make(scene, "signAtlas", S, S);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE; tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  g.fillStyle = "#000"; g.fillRect(0, 0, S, S);
  const rect = (x: number, y: number, w: number, h: number): Rect => [(x + 2) / S, 1 - (y + h - 2) / S, (x + w - 2) / S, 1 - (y + 2) / S];
  const out: SignAtlas = { tex, horiz: [], vert: [], bill: [], vend: [], named: {} };
  g.textAlign = "center"; g.textBaseline = "middle";
  BRANDS_H.forEach(([jp, en, bg, fg], i) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 128, w = 512, h = 128;
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 4; g.strokeRect(x + 8, y + 8, w - 16, h - 16); g.globalAlpha = 1;
    g.fillStyle = fg; g.font = `900 62px ${JP}`; g.fillText(jp, x + w / 2, y + 52, w - 40);
    g.font = `700 24px ${JP}`; g.fillText(en, x + w / 2, y + 100, w - 40);
    const r = rect(x, y, w, h); out.horiz.push(r);
    if (i === 16) out.named.centerGai = r; if (i === 17) out.named.station = r; if (i === 18) out.named.street1 = r; if (i === 19) out.named.street2 = r; if (i === 23) out.named.subway = r;
  });
  BRANDS_V.forEach(([jp, bg, fg], i) => {
    const x = i * 128, y = 768, w = 128, h = 512;
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    if (jp === "VEND") { // vending machine front
      g.fillStyle = "#f4f4f0"; g.fillRect(x + 10, y + 16, w - 20, 270);
      for (let rr = 0; rr < 3; rr++) for (let c = 0; c < 5; c++) { g.fillStyle = `hsl(${(c * 67 + rr * 40 + i * 30) % 360},70%,50%)`; g.fillRect(x + 16 + c * 20, y + 28 + rr * 84, 14, 52); g.fillStyle = "#333"; g.fillRect(x + 16 + c * 20, y + 86 + rr * 84, 14, 6); }
      g.fillStyle = "#111"; g.fillRect(x + 20, y + 400, w - 40, 60); g.fillStyle = fg; g.font = `900 26px ${JP}`; g.fillText("ドリンク", x + w / 2, y + 340);
      out.vend.push(rect(x, y, w, h));
      return;
    }
    g.fillStyle = fg; const n = jp.length, fs = Math.min(104, (h - 40) / n);
    g.font = `900 ${fs}px ${JP}`;
    for (let k = 0; k < n; k++) g.fillText(jp[k], x + w / 2, y + 30 + fs * (k + 0.5) + (h - 60 - fs * n) / 2);
    out.vert.push(rect(x, y, w, h));
  });
  BILLBOARDS.forEach(([top, brand, sub, hue], i) => {
    const x = (i % 4) * 512, y = 1280 + Math.floor(i / 4) * 384, w = 512, h = 384;
    const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, `hsl(${hue},70%,52%)`); gr.addColorStop(1, `hsl(${(hue + 40) % 360},75%,28%)`);
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = "rgba(255,255,255,0.13)"; g.beginPath(); g.arc(x + w * 0.78, y + h * 0.35, 150, 0, 7); g.fill(); g.beginPath(); g.arc(x + w * 0.2, y + h * 0.9, 110, 0, 7); g.fill();
    g.restore();
    g.fillStyle = "#fff"; g.font = `700 34px ${JP}`; g.fillText(top, x + w / 2, y + 64, w - 40);
    g.font = `900 78px ${JP}`; g.fillText(sub, x + w / 2, y + 180, w - 36);
    g.font = `800 40px ${JP}`; g.fillStyle = "rgba(255,255,255,0.92)"; g.fillText(brand, x + w / 2, y + 300, w - 40);
    out.bill.push(rect(x, y, w, h));
  });
  tex.update();
  return out;
}

// ---------- Animated ad screens ----------
const AD_WORDS: [string, string, number][][] = [
  [["交差点ビジョン", "KOSATEN VISION", 200], ["あおぞらソーダ", "AOZORA SODA — 新発売", 190], ["星空ステップ", "HOSHIZORA — NEW ALBUM", 285], ["ようこそ渋谷へ", "WELCOME TO SHIBUYA", 340]],
  [["ハナビ コレクション", "HANABI APPAREL 2026", 330], ["北の旅", "KITA RAIL PASS", 210], ["みどりの野菜", "MIDORI JUICE", 125]],
  [["ミライ電機", "MIRAI DENKI — SALE", 8], ["交差点の夜", "KOSATEN NO YORU — 近日公開", 28], ["ネオンマラソン", "TOKYO NEON MARATHON", 265]],
];
export class AdScreen {
  tex: DynamicTexture; private g: CanvasRenderingContext2D; private last = -1;
  constructor(scene: Scene, private variant: number, private w = 512, private h = 288) {
    const m = make(scene, "adScreen" + variant, w, h, false);
    this.tex = m.tex; this.g = m.g; this.tex.wrapU = Texture.CLAMP_ADDRESSMODE; this.tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.draw(0);
  }
  /** Redraws at ~12 fps. */
  update(t: number) { const f = Math.floor(t * 12); if (f !== this.last) { this.last = f; this.draw(t); } }
  private draw(t: number) {
    const g = this.g, w = this.w, h = this.h, ads = AD_WORDS[this.variant % AD_WORDS.length];
    const period = 6, idx = Math.floor(t / period + this.variant * 0.37) % ads.length, lt = (t + this.variant * 0.37 * period) % period;
    const [jp, en, hue] = ads[idx];
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, `hsl(${hue + Math.sin(t * 0.7) * 14},80%,${48 + Math.sin(t) * 6}%)`); gr.addColorStop(1, `hsl(${(hue + 50) % 360},85%,24%)`);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.1)";
    for (let i = -2; i < 9; i++) { const x = ((i * 90 + t * 60) % (w + 180)) - 90; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 40, 0); g.lineTo(x - 60, h); g.lineTo(x - 100, h); g.fill(); }
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(w * (0.15 + i * 0.2) + Math.sin(t * 0.9 + i) * 30, h * 0.5 + Math.cos(t * 0.7 + i * 2) * 70, 26 + i * 6, 0, 7); g.fill(); }
    const a = Math.min(1, lt / 0.5) * Math.min(1, (period - lt) / 0.5), slide = (1 - Math.min(1, lt / 0.6)) * 80;
    g.globalAlpha = a; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff";
    g.font = `900 ${Math.min(86, (w - 40) / jp.length * 1.05)}px ${JP}`; g.fillText(jp, w / 2 + slide, h * 0.42, w - 30);
    g.font = `800 26px ${JP}`; g.fillText(en, w / 2 - slide, h * 0.74, w - 30);
    g.globalAlpha = 1;
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, h - 22, w, 22); g.fillStyle = "#fff"; g.font = `700 14px ${JP}`; g.textAlign = "left";
    const tick = "渋谷スクランブル交差点 ◆ SHIBUYA SCRAMBLE ◆ 今日もいい一枚を ◆ STREET PHOTOGRAPHER ◆ ";
    g.fillText(tick + tick, -((t * 50) % 520), h - 10);
    this.tex.update();
  }
}

/** Round lamp lens (white: tinted by the material's emissive colour). */
export function lampTex(scene: Scene) {
  const { tex, g } = make(scene, "lampLens", 64, 64);
  g.fillStyle = "#000"; g.fillRect(0, 0, 64, 64);
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 28); gr.addColorStop(0, "#fff"); gr.addColorStop(0.75, "#ddd"); gr.addColorStop(1, "#000");
  g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill();
  tex.update(); return tex;
}

/** Pedestrian signal pictogram: standing (stop) or walking (go) figure, white on black. */
export function pedIconTex(scene: Scene, walking: boolean) {
  const { tex, g } = make(scene, walking ? "pedGo" : "pedStop", 128, 128);
  g.fillStyle = "#000"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineCap = "round"; g.lineWidth = 11;
  g.beginPath(); g.arc(walking ? 68 : 64, 26, 11, 0, 7); g.fill();
  const line = (...p: number[]) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };
  if (walking) { line(66, 44, 60, 76); line(60, 76, 40, 110); line(60, 76, 80, 92, 84, 112); line(64, 50, 44, 66); line(64, 50, 86, 62); }
  else { g.lineWidth = 18; line(64, 46, 64, 78); g.lineWidth = 11; line(57, 80, 57, 112); line(71, 80, 71, 112); line(48, 46, 46, 76); line(80, 46, 82, 76); }
  tex.update(); return tex;
}

export function rainTex(scene: Scene) {
  const { tex, g } = make(scene, "rainStreak", 16, 64, false);
  g.clearRect(0, 0, 16, 64);
  const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, "rgba(220,230,255,0)"); gr.addColorStop(0.5, "rgba(220,230,255,0.9)"); gr.addColorStop(1, "rgba(220,230,255,0)");
  g.fillStyle = gr; g.fillRect(6, 0, 3, 64);
  tex.hasAlpha = true; tex.update(); return tex;
}

export function skyTex(scene: Scene) {
  const m = make(scene, "skyGradient", 8, 256, false);
  m.tex.wrapU = Texture.CLAMP_ADDRESSMODE; m.tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return m;
}
export function paintSky(m: { tex: DynamicTexture; g: CanvasRenderingContext2D }, top: string, mid: string, horizon: string) {
  const gr = m.g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.32, top); gr.addColorStop(0.44, mid); gr.addColorStop(0.5, horizon); gr.addColorStop(1, horizon);
  m.g.fillStyle = gr; m.g.fillRect(0, 0, 8, 256); m.tex.update();
}
