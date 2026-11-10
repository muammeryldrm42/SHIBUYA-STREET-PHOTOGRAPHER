import { useEffect, useMemo, useState } from "react";
import { ui } from "../state/store";
import { Gallery, AlbumPhoto, downloadBlob, toJpeg } from "../data/gallery";
import { ScoreCard } from "./Overlays";
import { shutterLabel, fmtComp, fmtDate, fmtBytes } from "./util";

export function GalleryView({ onClose }: { onClose: () => void }) {
  const [photos, setPhotos] = useState<AlbumPhoto[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [err, setErr] = useState("");
  const load = () => {
    Gallery.list().then(setPhotos).catch(() => { setPhotos([]); setErr("This browser blocked local storage, so the album is unavailable. Downloads still work from the photo preview."); });
    Gallery.usage().then(setUsage).catch(() => {});
  };
  useEffect(load, []);
  // object URLs for thumbnails / the opened photo
  const thumbs = useMemo(() => new Map((photos ?? []).map((p) => [p.id, URL.createObjectURL(p.thumb)])), [photos]);
  useEffect(() => () => thumbs.forEach((u) => URL.revokeObjectURL(u)), [thumbs]);
  const cur = photos?.find((p) => p.id === open) ?? null;
  const full = useMemo(() => (cur ? URL.createObjectURL(cur.blob) : null), [cur?.id]);
  useEffect(() => () => { if (full) URL.revokeObjectURL(full); }, [full]);
  const list = (photos ?? []).filter((p) => !favOnly || p.favorite);
  const fav = async (p: AlbumPhoto) => { await Gallery.setFavorite(p.id, !p.favorite); load(); };
  const del = async (p: AlbumPhoto) => { if (!confirm("Delete this photo from the album? This cannot be undone.")) return; await Gallery.remove(p.id); setOpen(null); load(); };
  const dl = async (p: AlbumPhoto, jpg: boolean) => { try { downloadBlob(jpg ? await toJpeg(p.blob) : p.blob, `${p.meta.fileBase}.${jpg ? "jpg" : "png"}`); } catch { ui.toast("Download failed"); } };
  const near = usage && usage.quota > 0 && usage.used / usage.quota > 0.85;
  return (
    <div className="overlay solid gallery">
      <div className="panel full">
        <header className="panel-head">
          <div><h2>Portfolio</h2><span className="sub">{photos ? `${photos.length} ${photos.length === 1 ? "photo" : "photos"}` : "Loading…"}{usage ? ` · ${fmtBytes(usage.used)} used in this browser` : ""}</span></div>
          <div className="head-actions">
            <button className={`btn ${favOnly ? "primary" : ""}`} onClick={() => setFavOnly(!favOnly)}>★ Favorites</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </header>
        <p className={`note ${near ? "warn" : ""}`}>{near ? "Browser storage is almost full — download your photos and delete some to make room. " : ""}Photos live only in this browser on this device. Clearing site data removes them, so download the ones you want to keep.</p>
        {err && <p className="note warn">{err}</p>}
        {photos && list.length === 0 && <div className="empty"><b>{favOnly ? "No favorites yet" : "Your portfolio is empty"}</b><span>{favOnly ? "Star a photo to keep it here." : "Ask someone on the street for a portrait, shoot it, then press Save Photo."}</span></div>}
        <div className="grid">
          {list.map((p) => (
            <button key={p.id} className="tile" onClick={() => setOpen(p.id)}>
              <img src={thumbs.get(p.id)} alt={p.meta.npcName ? `Portrait of ${p.meta.npcName}` : "Street photo"} loading="lazy" />
              <div className="tile-meta"><b>{p.meta.npcName ?? "Free shot"}</b><span>{p.meta.score ? p.meta.score.total : "—"}</span></div>
              {p.favorite && <i className="star">★</i>}
            </button>
          ))}
        </div>
      </div>
      {cur && full && (
        <div className="lightbox" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="lightbox-inner">
            <img src={full} alt={cur.meta.npcName ? `Portrait of ${cur.meta.npcName}` : "Street photo"} />
            <aside>
              <h3>{cur.meta.npcName ?? "Free shot"}</h3>
              <dl>
                <dt>Date</dt><dd>{fmtDate(cur.meta.takenAt)}</dd>
                <dt>Type</dt><dd>{cur.meta.portraitType ? `${cur.meta.portraitType} portrait` : "unscored street shot"}</dd>
                <dt>Camera</dt><dd className="mono">{cur.meta.focal}mm · f/{cur.meta.aperture} · {shutterLabel(cur.meta.shutter)} · ISO {cur.meta.iso} · {fmtComp(cur.meta.comp)} EV</dd>
                <dt>Scene</dt><dd>{cur.meta.time}, {cur.meta.weather} · {cur.meta.width}×{cur.meta.height}</dd>
              </dl>
              <ScoreCard score={cur.meta.score} />
              <div className="actions">
                <button className="btn primary" onClick={() => dl(cur, false)}>Download PNG</button>
                <button className="btn" onClick={() => dl(cur, true)}>Download JPG</button>
                <button className="btn" onClick={() => fav(cur)}>{cur.favorite ? "★ Favorite" : "☆ Favorite"}</button>
                <button className="btn ghost" onClick={() => del(cur)}>Delete</button>
                <button className="btn" onClick={() => setOpen(null)}>Back</button>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
