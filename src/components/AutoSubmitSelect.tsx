"use client";

export default function AutoSubmitSelect({ name, defaultValue, options }: { name: string; defaultValue: string; options: [string, string][] }) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label="Update status"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="rounded-md border border-line bg-white px-2 py-1 text-xs">
      {options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}
