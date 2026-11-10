export function shutterLabel(t: number): string {
  const stops = [15, 30, 60, 125, 250, 500, 1000, 2000, 4000, 8000];
  const inv = 1 / t; let best = stops[0];
  for (const s of stops) if (Math.abs(Math.log2(s / inv)) < Math.abs(Math.log2(best / inv))) best = s;
  return `1/${best}`;
}
export const fmtComp = (c: number) => (Math.abs(c) < 0.05 ? "±0.0" : `${c > 0 ? "+" : "−"}${Math.abs(c).toFixed(1)}`);
export function scoreWord(s: number): string { return s >= 85 ? "Excellent" : s >= 70 ? "Great" : s >= 50 ? "Good" : s >= 30 ? "Fair" : "Rough"; }
export function fmtDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export const fmtBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`);

/** Where an overlay returns to when closed. */
export const nav = { fromPause: false };
