"use client";

import { useCallback, useEffect, useState } from "react";

export type Photo = { src: string; caption?: string | null; meta?: string | null };

/** A grid of photos that opens full screen when tapped. Arrow keys / swipe buttons move between them. */
export function PhotoGrid({ photos, className = "grid grid-cols-2 gap-2 sm:grid-cols-3", tile = "aspect-[4/3]" }: { photos: Photo[]; className?: string; tile?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const move = useCallback((d: number) => setOpen((i) => (i == null ? i : (i + d + photos.length) % photos.length)), [photos.length]);
  useEffect(() => {
    if (open == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") move(1);
      if (e.key === "ArrowLeft") move(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, move]);
  const cur = open != null ? photos[open] : null;
  return (
    <>
      <ul className={className}>
        {photos.map((p, i) => (
          <li key={p.src + i}>
            <button type="button" onClick={() => setOpen(i)} className={`group block w-full overflow-hidden bg-divider ${tile}`} aria-label={p.caption ?? "Open photo"}>
              <img src={p.src} alt={p.caption ?? ""} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
            </button>
            {p.caption && <p className="mt-1.5 text-xs text-stone">{p.caption}</p>}
          </li>
        ))}
      </ul>
      {cur && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-charcoal/95 text-ivory" onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between px-5 py-4 text-sm">
            <span className="text-ivory/70">{(open ?? 0) + 1} / {photos.length}</span>
            <button type="button" className="text-ivory/80 hover:text-ivory" onClick={() => setOpen(null)}>Close ✕</button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
            <img src={cur.src} alt={cur.caption ?? ""} className="max-h-full max-w-full object-contain" />
            {photos.length > 1 && <>
              <button type="button" aria-label="Previous" onClick={() => move(-1)} className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/30 px-3 py-2 text-2xl hover:bg-black/50">‹</button>
              <button type="button" aria-label="Next" onClick={() => move(1)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/30 px-3 py-2 text-2xl hover:bg-black/50">›</button>
            </>}
          </div>
          <div className="px-5 py-4 text-center text-sm" onClick={(e) => e.stopPropagation()}>
            {cur.caption && <div className="font-serif text-xl">{cur.caption}</div>}
            {cur.meta && <div className="mt-1 text-xs text-ivory/60">{cur.meta}</div>}
          </div>
        </div>
      )}
    </>
  );
}
