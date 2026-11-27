import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AREAS } from "@/lib/format";
import { SNAG_CATEGORY_LABEL } from "@/lib/release4";
import { ActionForm, Submit } from "@/components/ActionForm";
import { FileInput } from "@/components/FileInput";
import { raiseSnagAction } from "@/app/actions/snags";

export const metadata = { title: "Raise a concern" };
const field = "mt-1 w-full border border-divider bg-paper px-3 py-2.5 text-[15px] focus:border-charcoal focus:outline-none";

export default async function RaiseConcern() {
  await requireUser("client");
  return (
    <>
      <Link href="/c/snags" className="text-sm text-stone hover:text-charcoal">← Snags &amp; concerns</Link>
      <h1 className="mt-6 font-serif text-5xl">Raise a concern</h1>
      <p className="mt-4 max-w-xl text-stone">Tell us what is not right. Your project manager is notified at once and will assign someone to look into it.</p>
      <ActionForm action={raiseSnagAction} className="mt-10 grid max-w-2xl gap-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div><label className="text-xs tracking-[0.15em] text-stone uppercase" htmlFor="area">Where in your home</label>
            <select id="area" name="area" className={field} required defaultValue=""><option value="" disabled>Choose…</option>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></div>
          <div><label className="text-xs tracking-[0.15em] text-stone uppercase" htmlFor="category">What kind of issue</label>
            <select id="category" name="category" className={field} required defaultValue=""><option value="" disabled>Choose…</option>{Object.entries(SNAG_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div><label className="text-xs tracking-[0.15em] text-stone uppercase" htmlFor="description">Describe it</label>
          <textarea id="description" name="description" rows={4} className={field} placeholder="e.g. The drawer below the hob does not close fully" required /></div>
        <div className="border border-divider bg-paper/60 p-4"><FileInput name="photos" label="Photographs" /></div>
        <fieldset>
          <legend className="text-xs tracking-[0.15em] text-stone uppercase">How urgent is it? (optional)</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {[["low", "Can wait"], ["medium", "Soon"], ["high", "Urgent"], ["critical", "Emergency (water, power, safety)"]].map(([v, l]) => (
              <label key={v} className="cursor-pointer border border-divider px-3 py-2 text-sm has-[:checked]:border-charcoal has-[:checked]:bg-paper"><input type="radio" name="urgency" value={v} className="mr-2 accent-charcoal" />{l}</label>
            ))}
          </div>
        </fieldset>
        <div><Submit className="bg-charcoal px-6 py-3 text-sm tracking-wide text-ivory hover:bg-black" pendingText="Sending…">Send to our team</Submit></div>
      </ActionForm>
    </>
  );
}
