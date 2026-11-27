import { fileUrl, fmtSize } from "@/lib/files";
import { fmtDateTime } from "@/lib/format";
import { DOC_TYPE_LABEL } from "@/lib/release4";
import { documentVisibilityAction, uploadDocumentAction } from "@/app/actions/documents";
import { ActionForm, Submit } from "./ActionForm";
import { FileInput } from "./FileInput";
import { Badge, Empty } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export function UploadDocumentForm({ projectId, canShare, supersedes }: { projectId: string; canShare: boolean; supersedes?: R }) {
  return (
    <ActionForm action={uploadDocumentAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="project_id" value={projectId} />
      {supersedes && <input type="hidden" name="supersedes_id" value={supersedes.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Title</label><input name="title" defaultValue={supersedes?.title ?? ""} className="input" placeholder="e.g. Kitchen elevation drawings" required /></div>
        <div><label className="label">Type</label>
          <select name="doc_type" defaultValue={supersedes?.doc_type ?? "other"} className="input">{Object.entries(DOC_TYPE_LABEL).filter(([k]) => canShare || k !== "quotation").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div><label className="label">Description (optional)</label><input name="description" className="input" placeholder={supersedes ? "What changed in this version" : ""} /></div>
      <FileInput name="file" multiple={false} label="File" />
      {canShare ? <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" name="client_visible" defaultChecked={supersedes?.client_visible ?? false} /> Share with the client</label>
        : <p className="text-xs text-ink-3">Your upload is for the team. The project manager can share it with the client.</p>}
      <Submit className={supersedes ? "btn-ghost" : "btn-brand"} pendingText="Uploading…">{supersedes ? `Upload version ${supersedes.version + 1}` : "Upload document"}</Submit>
    </ActionForm>
  );
}

export function DocumentRows({ docs, projectId, canManage, canUpload }: { docs: R[]; projectId: string; canManage: boolean; canUpload: boolean }) {
  if (!docs.length) return <div className="p-4"><Empty title="No documents yet">Floor plans, measurements, design presentations, 3D renders, layouts and specifications.</Empty></div>;
  return (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.id} id={`d-${d.id}`} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={fileUrl(d.storage_path)} target="_blank" className="font-medium text-ink hover:underline">{d.title}</a>
                <Badge>{DOC_TYPE_LABEL[d.doc_type]}</Badge>
                {d.version > 1 && <Badge tone="blue">Version {d.version}</Badge>}
                <Badge tone={d.client_visible ? "green" : "gray"}>{d.client_visible ? "Shared with client" : "Team only"}</Badge>
              </div>
              {d.description && <div className="mt-0.5 text-sm text-ink-2">{d.description}</div>}
              <div className="mt-0.5 text-xs text-ink-3">{d.file_name} · {d.size_bytes ? fmtSize(d.size_bytes) : ""} · {d.uploaded_by_name} · {fmtDateTime(d.created_at)}</div>
              {d.older.length > 0 && (
                <div className="mt-1 text-xs text-ink-3">Earlier: {d.older.map((o: R, i: number) => <span key={o.id}>{i ? ", " : ""}<a href={fileUrl(o.storage_path)} target="_blank" className="hover:underline">v{o.version}</a></span>)}</div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <a href={fileUrl(d.storage_path, true)} className="btn-ghost !px-2 !py-1 text-xs">Download</a>
              {canManage && (
                <ActionForm action={documentVisibilityAction} className="flex gap-1.5">
                  <input type="hidden" name="id" value={d.id} />
                  <Submit className="btn-ghost !px-2 !py-1 text-xs" name="share" value={d.client_visible ? "no" : "yes"} pendingText="…">{d.client_visible ? "Hide from client" : "Share with client"}</Submit>
                </ActionForm>
              )}
            </div>
          </div>
          {canUpload && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-brand hover:underline">Upload a new version</summary>
              <div className="mt-2 max-w-xl rounded-md border border-line p-3"><UploadDocumentForm projectId={projectId} canShare={canManage} supersedes={d} /></div>
            </details>
          )}
          {canManage && (
            <ActionForm action={documentVisibilityAction} confirm="Remove this document? Earlier versions stay." className="mt-1">
              <input type="hidden" name="id" value={d.id} />
              <Submit className="text-[11px] text-red-600 hover:underline" name="share" value="remove" pendingText="…">Remove</Submit>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}
