"use client";

import { useState } from "react";

const MAX = 4 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Shrinks large photos in the browser so uploads stay fast and under the size limit. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || (file.size < 1_500_000 && file.type !== "image/heic")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function FileInput({ name = "files", multiple = true, accept = "image/jpeg,image/png,image/webp,application/pdf", label }: {
  name?: string; multiple?: boolean; accept?: string; label?: string;
}) {
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      {label && <label className="label">{label}</label>}
      <input
        type="file"
        name={name}
        multiple={multiple}
        accept={accept}
        className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-canvas"
        onChange={async (e) => {
          const input = e.currentTarget;
          const picked = Array.from(input.files ?? []);
          if (!picked.length) return setNote("");
          setBusy(true);
          const out: File[] = [];
          const problems: string[] = [];
          for (const f of picked) {
            const g = await shrinkImage(f);
            if (!OK_TYPES.includes(g.type)) problems.push(`${f.name}: use JPG, PNG, WebP or PDF`);
            else if (g.size > MAX) problems.push(`${f.name}: larger than 4 MB`);
            else out.push(g);
          }
          const dt = new DataTransfer();
          out.forEach((f) => dt.items.add(f));
          input.files = dt.files;
          const total = out.reduce((s, f) => s + f.size, 0);
          setBusy(false);
          setNote(
            [
              out.length ? `${out.length} file${out.length > 1 ? "s" : ""} ready (${(total / 1024 / 1024).toFixed(1)} MB)` : "",
              total > MAX ? "Too large to send together. Choose fewer files." : "",
              ...problems,
            ].filter(Boolean).join(" · "),
          );
        }}
      />
      <p className="mt-1 text-xs text-ink-3">{busy ? "Preparing…" : note || "JPG, PNG, WebP or PDF, up to 4 MB each. Large photos are reduced automatically."}</p>
    </div>
  );
}
