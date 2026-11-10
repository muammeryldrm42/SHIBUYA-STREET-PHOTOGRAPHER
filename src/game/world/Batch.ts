// Static geometry batching: everything that shares a material is written into one mesh.
import { Mesh, VertexData, Scene, Material } from "@babylonjs/core";
import type { Rect } from "./textures";

type V = [number, number, number];
type C = [number, number, number];
const WHITE: C = [1, 1, 1];

export class Batch {
  private pos: number[] = []; private nrm: number[] = []; private uv: number[] = []; private col: number[] = []; private idx: number[] = [];

  /** Quad a→b→c→d (a,b bottom edge; d,c top edge) facing normal n. */
  quad(a: V, b: V, c: V, d: V, n: V, uv: Rect = [0, 0, 1, 1], col: C = WHITE) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) { this.nrm.push(...n); this.col.push(col[0], col[1], col[2], 1); }
    this.uv.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    // wind so that Babylon's (p0-p1)x(p2-p1) normal agrees with n
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
    const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (dot >= 0) this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3); else this.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }

  /**
   * Axis-aligned box. `tile` = metres per texture repeat on the sides (world-mapped UVs), or a fixed UV rect.
   */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: { tile?: number; rect?: Rect; col?: C; top?: boolean; bottom?: boolean; sides?: string; topRect?: Rect; tileV?: number } = {}) {
    const col = o.col ?? WHITE, sides = o.sides ?? "NSEW";
    const uvFor = (w0: number, w1: number): Rect => {
      if (o.rect) return o.rect;
      const t = o.tile ?? 1, tv = o.tileV ?? t;
      return [w0 / t, y0 / tv, w1 / t, y1 / tv];
    };
    if (sides.includes("S")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], uvFor(x0, x1), col);
    if (sides.includes("N")) this.quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], uvFor(-x1, -x0), col);
    if (sides.includes("E")) this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], uvFor(z0, z1), col);
    if (sides.includes("W")) this.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], uvFor(-z1, -z0), col);
    if (o.top !== false) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], o.topRect ?? o.rect ?? [x0 / (o.tile ?? 1), z0 / (o.tile ?? 1), x1 / (o.tile ?? 1), z1 / (o.tile ?? 1)], col);
    if (o.bottom) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], o.rect ?? [0, 0, 1, 1], col);
  }

  /** Vertical cylinder / cone / prism. UVs wrap `tile` metres per repeat, or map a rect across an arc. */
  cyl(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, n: number, o: { tile?: number; col?: C; top?: boolean; a0?: number; a1?: number; rect?: Rect } = {}) {
    const col = o.col ?? WHITE, a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2, t = o.tile ?? 1;
    for (let i = 0; i < n; i++) {
      const p = a0 + ((a1 - a0) * i) / n, q = a0 + ((a1 - a0) * (i + 1)) / n, m = (p + q) / 2;
      const c0 = Math.cos(p), s0 = Math.sin(p), c1 = Math.cos(q), s1 = Math.sin(q);
      const uv: Rect = o.rect
        ? [o.rect[0] + ((o.rect[2] - o.rect[0]) * i) / n, o.rect[1], o.rect[0] + ((o.rect[2] - o.rect[0]) * (i + 1)) / n, o.rect[3]]
        : [(p * r0) / t, y0 / t, (q * r0) / t, y1 / t];
      // listed so that the texture reads left-to-right when seen from outside
      this.quad([cx + c0 * r0, y0, cz + s0 * r0], [cx + c1 * r0, y0, cz + s1 * r0], [cx + c1 * r1, y1, cz + s1 * r1], [cx + c0 * r1, y1, cz + s0 * r1], [Math.cos(m), 0, Math.sin(m)], uv, col);
      if (o.top !== false && r1 > 0.001) this.quad([cx, y1, cz], [cx + c0 * r1, y1, cz + s0 * r1], [cx + c1 * r1, y1, cz + s1 * r1], [cx, y1, cz], [0, 1, 0], [0, 0, 0.01, 0.01], col);
    }
  }

  /** Flat quad lying on the ground, rotated by `ang` around Y. */
  ground(cx: number, cz: number, halfLen: number, halfWid: number, ang: number, y: number, col: C = WHITE, uv: Rect = [0, 0, 1, 1]) {
    const dx = Math.sin(ang), dz = Math.cos(ang), px = dz, pz = -dx;
    const p = (l: number, w: number): V => [cx + dx * l * halfLen + px * w * halfWid, y, cz + dz * l * halfLen + pz * w * halfWid];
    this.quad(p(-1, -1), p(-1, 1), p(1, 1), p(1, -1), [0, 1, 0], uv, col);
  }

  /** Upright sign panel centred at c, facing direction (nx,nz), size w x h. */
  panel(cx: number, cy: number, cz: number, nx: number, nz: number, w: number, h: number, uv: Rect, col: C = WHITE) {
    // right vector such that text reads correctly when looking at the panel from its front
    const rx = -nz, rz = nx, hw = w / 2, hh = h / 2;
    this.quad([cx - rx * hw, cy - hh, cz - rz * hw], [cx + rx * hw, cy - hh, cz + rz * hw], [cx + rx * hw, cy + hh, cz + rz * hw], [cx - rx * hw, cy + hh, cz - rz * hw], [nx, 0, nz], uv, col);
  }

  get empty() { return this.idx.length === 0; }

  build(name: string, scene: Scene, mat: Material, o: { shadows?: boolean; cast?: boolean } = {}): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.normals = this.nrm; vd.uvs = this.uv; vd.colors = this.col; vd.indices = this.idx;
    vd.applyToMesh(m);
    m.material = mat; m.isPickable = false; m.receiveShadows = o.shadows ?? false;
    m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true;
    return m;
  }
}
