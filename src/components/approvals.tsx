import type { Revision } from "@/lib/approvals";
import { fileUrl, fmtSize } from "@/lib/files";
import { inr } from "@/lib/format";
import type { Tone } from "./ui";

export const APPROVAL_TONE: Record<string, Tone> = {
  draft: "gray", pending: "amber", approved: "green", changes_requested: "red", query_raised: "blue", withdrawn: "gray",
};
export const REVISION_TONE: Record<string, Tone> = {
  draft: "gray", published: "amber", approved: "green", changes_requested: "red", query_raised: "blue", superseded: "gray",
};
export const PAYMENT_TONE: Record<string, Tone> = {
  upcoming: "gray", due: "amber", partially_paid: "blue", paid: "green", overdue: "red", on_hold: "gray",
};

export function specRows(r: Revision): [string, string][] {
  const rows: [string, string | null][] = [
    ["Brand", r.material_brand],
    ["Material type", r.material_type],
    ["Specifications", r.specifications],
    ["Colour", r.colour],
    ["Finish", r.finish],
    ["Dimensions", r.dimensions],
    ["Quantity", r.quantity != null ? `${Number(r.quantity).toLocaleString("en-IN")}${r.quantity_unit ? ` ${r.quantity_unit}` : ""}` : null],
    ["Commercial impact", r.commercial_impact_paise != null && r.commercial_impact_paise !== 0
      ? `${r.commercial_impact_paise > 0 ? "+" : "−"}${inr(Math.abs(r.commercial_impact_paise))}${r.commercial_impact_paise > 0 ? " additional" : " saving"}`
      : null],
  ];
  return rows.filter((x): x is [string, string] => !!x[1]);
}

/** Design files: images as thumbnails, PDFs as links. Internal style. */
export function FileGallery({ files, onRemove }: { files: Revision["files"]; onRemove?: (fileId: string) => React.ReactNode }) {
  if (!files?.length) return <p className="text-sm text-ink-3">No files attached.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {files.map((f) => (
        <li key={f.id} className="overflow-hidden rounded-md border border-line bg-white">
          <a href={fileUrl(f.id)} target="_blank" rel="noopener" className="block">
            {f.mime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(f.id)} alt={f.name} className="aspect-[4/3] w-full bg-canvas object-cover" loading="lazy" />
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center bg-canvas text-xs font-semibold text-ink-3">PDF</div>
            )}
          </a>
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
            <span className="truncate text-ink-2" title={f.name}>{f.name}</span>
            <span className="shrink-0 text-ink-3">{fmtSize(f.size)}</span>
          </div>
          {onRemove && <div className="border-t border-line px-2 py-1">{onRemove(f.id)}</div>}
        </li>
      ))}
    </ul>
  );
}
