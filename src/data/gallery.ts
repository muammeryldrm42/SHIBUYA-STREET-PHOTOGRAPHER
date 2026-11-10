// GalleryManager: photo album stored as Blobs in IndexedDB. No engine imports.
import type { ShotMeta } from "../state/store";

export interface AlbumPhoto {
  id: string;
  meta: ShotMeta;
  blob: Blob; // full-resolution PNG
  thumb: Blob; // small JPEG
  favorite: boolean;
  savedAt: number;
}

const DB = "ssp-gallery";
const STORE = "photos";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { res(req.result); db.close(); };
    t.onerror = () => { rej(t.error); db.close(); };
    t.onabort = () => { rej(t.error || new DOMException("Aborted", "AbortError")); db.close(); };
  }));
}

export class QuotaError extends Error {}

export const Gallery = {
  async save(p: AlbumPhoto): Promise<void> {
    try {
      await tx("readwrite", (s) => s.put(p));
    } catch (e) {
      const name = (e as DOMException | null)?.name || "";
      if (/Quota/i.test(name)) throw new QuotaError("Browser storage is full. Download your photos, then delete some from the album.");
      throw e;
    }
  },
  list(): Promise<AlbumPhoto[]> {
    return tx<AlbumPhoto[]>("readonly", (s) => s.getAll()).then((a) => a.sort((x, y) => y.savedAt - x.savedAt));
  },
  remove(id: string): Promise<void> { return tx("readwrite", (s) => s.delete(id)).then(() => undefined); },
  async setFavorite(id: string, favorite: boolean): Promise<void> {
    const p = await tx<AlbumPhoto | undefined>("readonly", (s) => s.get(id));
    if (p) await tx("readwrite", (s) => s.put({ ...p, favorite }));
  },
  async usage(): Promise<{ used: number; quota: number } | null> {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { used: e.usage || 0, quota: e.quota || 0 };
  },
};

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Re-encode a PNG blob as JPEG (real conversion through a canvas). */
export async function toJpeg(png: Blob, quality = 0.92): Promise<Blob> {
  const bmp = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("JPEG encode failed"))), "image/jpeg", quality));
}
