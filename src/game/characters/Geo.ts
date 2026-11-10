// Small geometry builder: lofted tubes and blobs with vertex colours and optional bone weights.
import { Mesh, VertexData, Scene, Color3 } from "@babylonjs/core";

export type V3 = [number, number, number];
export type RGB = [number, number, number];
export type W = [number, number][];

export interface Ring {
  c: V3; u: V3; v: V3;
  /** colour of the segment that starts at this ring */
  col: RGB | ((t: number) => RGB);
  w?: W | ((t: number) => W);
  a0?: number; a1?: number; // open arc (radians); omitted = closed loop
  n?: number; // superellipse exponent (2 = ellipse, 4+ = boxy)
}

export function hex(h: string): RGB {
  const c = Color3.FromHexString(h).toLinearSpace();
  return [c.r, c.g, c.b];
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shade = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

const sp = (c: number, n: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

export class Geo {
  pos: number[] = []; col: number[] = []; idx: number[] = []; bi: number[] = []; bw: number[] = [];
  defaultW: W = [[0, 1]];

  vert(p: V3, c: RGB, w?: W): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.col.push(c[0], c[1], c[2], 1);
    const ww = w && w.length ? w : this.defaultW;
    let s = 0;
    for (let k = 0; k < 4; k++) s += ww[k]?.[1] ?? 0;
    for (let k = 0; k < 4; k++) { this.bi.push(ww[k]?.[0] ?? 0); this.bw.push((ww[k]?.[1] ?? 0) / (s || 1)); }
    return i;
  }

  /** Adds a triangle wound so its normal points away from `inside`. */
  tri(a: number, b: number, c: number, inside: V3) {
    const P = this.pos;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    // Babylon's ComputeNormals convention: n = (a - b) x (c - b)
    const ux = ax - bx, uy = ay - by, uz = az - bz, vx = cx - bx, vy = cy - by, vz = cz - bz;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ox = (ax + bx + cx) / 3 - inside[0], oy = (ay + by + cy) / 3 - inside[1], oz = (az + bz + cz) / 3 - inside[2];
    if (nx * nx + ny * ny + nz * nz < 1e-16) return;
    if (nx * ox + ny * oy + nz * oz >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }

  private row(r: Ring, seg: number, colSrc: Ring, angles?: number[]): number[] {
    const closed = r.a0 === undefined;
    const n = angles ? angles.length : closed ? seg : seg + 1;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = angles ? angles[i] : closed ? (i / seg) * Math.PI * 2 : r.a0! + ((r.a1! - r.a0!) * i) / seg;
      let cs = Math.cos(t), sn = Math.sin(t);
      if (r.n && r.n !== 2) { cs = sp(cs, r.n); sn = sp(sn, r.n); }
      const p: V3 = [r.c[0] + r.u[0] * cs + r.v[0] * sn, r.c[1] + r.u[1] * cs + r.v[1] * sn, r.c[2] + r.u[2] * cs + r.v[2] * sn];
      const col = typeof colSrc.col === "function" ? colSrc.col(t) : colSrc.col;
      const w = typeof r.w === "function" ? r.w(t) : r.w;
      out.push(this.vert(p, col, w));
    }
    return out;
  }

  /** Loft through rings. Each segment takes the colour of its first ring (hard colour edges). */
  tube(rings: Ring[], seg = 12, capA = true, capB = true, angles?: number[]) {
    const closed = rings[0].a0 === undefined;
    let prev: number[] | null = null;
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], B = rings[k + 1];
      const sameCol = k > 0 && rings[k - 1].col === A.col;
      const ra: number[] = prev && sameCol ? prev : this.row(A, seg, A, angles);
      const rb = this.row(B, seg, A, angles);
      const inside: V3 = [(A.c[0] + B.c[0]) / 2, (A.c[1] + B.c[1]) / 2, (A.c[2] + B.c[2]) / 2];
      const n = ra.length, lim = closed ? n : n - 1;
      for (let i = 0; i < lim; i++) {
        const j = (i + 1) % n;
        this.tri(ra[i], ra[j], rb[i], inside);
        this.tri(ra[j], rb[j], rb[i], inside);
      }
      if (k === 0 && capA && closed) this.cap(A, ra, inside);
      if (k === rings.length - 2 && capB && closed) this.cap(B, rb, inside, A);
      prev = rb;
    }
  }

  private cap(r: Ring, row: number[], inside: V3, colSrc?: Ring) {
    const src = colSrc || r;
    const col = typeof src.col === "function" ? src.col(0) : src.col;
    const w = typeof r.w === "function" ? r.w(0) : r.w;
    const c = this.vert(r.c, col, w);
    for (let i = 0; i < row.length; i++) this.tri(c, row[i], row[(i + 1) % row.length], inside);
  }

  /** Ellipsoid (or rounded box when n > 2). */
  blob(c: V3, r: V3, col: RGB, w?: W, seg = 8, rings = 5, n = 2) {
    const rs: Ring[] = [];
    for (let k = 0; k <= rings; k++) {
      const phi = 0.12 + (Math.PI - 0.24) * (k / rings);
      let s = Math.sin(phi), cy = -Math.cos(phi);
      if (n !== 2) { s = sp(s, n); cy = sp(cy, n); }
      rs.push({ c: [c[0], c[1] + r[1] * cy, c[2]], u: [r[0] * s, 0, 0], v: [0, 0, r[2] * s], col, w, n });
    }
    this.tube(rs, seg);
  }

  /** Round tube following a path, with a radius per point. */
  path(pts: V3[], radii: number[], col: RGB, w?: W | ((i: number) => W), seg = 6, flat = 1) {
    const rs: Ring[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // reference axis least aligned with the tangent
      const ref: V3 = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let ux = ty * ref[2] - tz * ref[1], uy = tz * ref[0] - tx * ref[2], uz = tx * ref[1] - ty * ref[0];
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      const r = radii[Math.min(i, radii.length - 1)];
      rs.push({ c: pts[i], u: [ux * r, uy * r, uz * r], v: [vx * r * flat, vy * r * flat, vz * r * flat], col, w: typeof w === "function" ? w(i) : w });
    }
    this.tube(rs, seg);
  }

  /** Axis-aligned box with slightly rounded look (superellipse loft). */
  box(c: V3, half: V3, col: RGB, w?: W, n = 8) { this.blob(c, [half[0] * 1.08, half[1] * 1.08, half[2] * 1.08], col, w, 12, 6, n); }

  /** Transform all vertices added since `from` (vertex index). */
  transform(from: number, fn: (p: V3) => V3) {
    for (let i = from * 3; i < this.pos.length; i += 3) {
      const q = fn([this.pos[i], this.pos[i + 1], this.pos[i + 2]]);
      this.pos[i] = q[0]; this.pos[i + 1] = q[1]; this.pos[i + 2] = q[2];
    }
  }
  get count() { return this.pos.length / 3; }

  /** Smooth normals, welded across duplicated colour seams. */
  normals(): Float32Array {
    const nrm = new Float32Array(this.pos.length);
    VertexData.ComputeNormals(this.pos, this.idx, nrm);
    const map = new Map<string, number[]>();
    for (let i = 0; i < this.pos.length; i += 3) {
      const k = `${Math.round(this.pos[i] * 2000)},${Math.round(this.pos[i + 1] * 2000)},${Math.round(this.pos[i + 2] * 2000)}`;
      const l = map.get(k); if (l) l.push(i); else map.set(k, [i]);
    }
    for (const l of map.values()) {
      if (l.length < 2) continue;
      let x = 0, y = 0, z = 0;
      for (const i of l) { x += nrm[i]; y += nrm[i + 1]; z += nrm[i + 2]; }
      const d = Math.hypot(x, y, z) || 1;
      for (const i of l) { nrm[i] = x / d; nrm[i + 1] = y / d; nrm[i + 2] = z / d; }
    }
    return nrm;
  }

  toMesh(name: string, scene: Scene, skinned = false): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.indices = this.idx; vd.normals = this.normals(); vd.colors = this.col;
    if (skinned) { vd.matricesIndices = this.bi; vd.matricesWeights = this.bw; }
    vd.applyToMesh(m);
    return m;
  }
}
