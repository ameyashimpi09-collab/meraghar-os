import { requireUser } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { fmtDate, relDay, todayIST } from "@/lib/format";
import { clientProjectId, dims, purchaseList, PURCHASE_CLIENT_LABEL } from "@/lib/release4";
import { ActionForm, Submit } from "@/components/ActionForm";
import { clientPurchaseAction } from "@/app/actions/purchases";

export const metadata = { title: "Purchases" };

/* eslint-disable @typescript-eslint/no-explicit-any */
const CLOSED = ["delivered", "installed", "cancelled"];

function tone(x: any, today: string) {
  if (x.status === "delayed" || (x.required_delivery_date && x.required_delivery_date < today && !CLOSED.includes(x.status))) return "text-alert";
  if (["purchase_required", "client_informed"].includes(x.status)) return "text-amber";
  if (["delivered", "installed"].includes(x.status)) return "text-sage";
  return "text-stone";
}

function Item({ x, today }: { x: any; today: string }) {
  const d = dims(x);
  const mine = x.responsibility !== "company";
  const late = x.required_delivery_date && x.required_delivery_date < today && !CLOSED.includes(x.status);
  return (
    <li id={`p-${x.id}`} className="scroll-mt-24 py-8">
      <div className="grid gap-4 md:grid-cols-[160px_1fr] md:gap-6">
        <div>{x.reference_image_path ? <a href={fileUrl(x.reference_image_path)} target="_blank"><img src={fileUrl(x.reference_image_path)} alt="" className="aspect-square w-full max-w-28 bg-divider object-cover md:max-w-40" /></a>
          : <div className="hidden aspect-square w-full max-w-40 items-center md:flex justify-center border border-divider text-[11px] tracking-[0.2em] text-stone uppercase">{x.category ?? "Item"}</div>}</div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="text-[11px] tracking-[0.2em] text-stone uppercase">{[x.area, x.category].filter(Boolean).join(" · ")}</div>
              <h2 className="mt-1 font-serif text-3xl">{x.item_name}{x.quantity > 1 ? <span className="text-stone"> × {x.quantity}</span> : null}</h2>
            </div>
            <div className={`text-sm ${tone(x, today)}`}>{late ? "Late for site" : PURCHASE_CLIENT_LABEL[x.status]}</div>
          </div>
          {x.description && <p className="mt-3 max-w-2xl leading-relaxed text-charcoal/80">{x.description}</p>}

          <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
            {d && <div className="sm:col-span-3"><dt className="text-xs text-stone">Required size</dt><dd className="mt-0.5 font-serif text-2xl tabular-nums">{d.main}</dd><dd className="text-xs text-stone">That is about {d.alt}</dd></div>}
            <div><dt className="text-xs text-stone">Please buy by</dt><dd className="mt-0.5">{fmtDate(x.required_purchase_date)}</dd></div>
            <div><dt className="text-xs text-stone">Needed at site by</dt><dd className={`mt-0.5 ${late ? "text-alert" : ""}`}>{fmtDate(x.required_delivery_date)}{x.required_delivery_date && !CLOSED.includes(x.status) ? <span className="block text-xs text-stone">{relDay(x.required_delivery_date).replace("overdue", "late")}</span> : null}</dd></div>
            {x.installation_date && <div><dt className="text-xs text-stone">Installation</dt><dd className="mt-0.5">{fmtDate(x.installation_date)}</dd></div>}
            {(x.brand || x.model) && <div><dt className="text-xs text-stone">Brand / model</dt><dd className="mt-0.5">{[x.brand, x.model].filter(Boolean).join(" · ")}</dd></div>}
            {x.technical_specs && <div className="sm:col-span-2"><dt className="text-xs text-stone">Technical requirements</dt><dd className="mt-0.5 whitespace-pre-line">{x.technical_specs}</dd></div>}
            {x.suggested_options && <div className="sm:col-span-3"><dt className="text-xs text-stone">Suggested options</dt><dd className="mt-0.5 whitespace-pre-line">{x.suggested_options}</dd></div>}
          </dl>

          {!mine ? <p className="mt-5 text-sm text-stone">Our team is buying this item for you.</p> : !["installed", "cancelled"].includes(x.status) && (
            <details className="mt-6 border-t border-divider pt-4" open={["purchase_required", "client_informed", "delayed"].includes(x.status) || !!late}>
              <summary className="cursor-pointer text-sm underline decoration-divider underline-offset-4">Update this purchase</summary>
              <ActionForm action={clientPurchaseAction} className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
                <input type="hidden" name="id" value={x.id} />
                <div className="sm:col-span-2">
                  <div className="text-xs text-stone">Where is it now?</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[["purchased", "I have bought it"], ["delivery_scheduled", "Delivery is booked"], ["delivered", "Delivered to site"]].map(([v, l]) => (
                      <label key={v} className="cursor-pointer border border-divider px-3 py-2 text-sm has-[:checked]:border-charcoal has-[:checked]:bg-paper">
                        <input type="radio" name="status" value={v} defaultChecked={x.status === v} className="mr-2 accent-charcoal" />{l}
                      </label>
                    ))}
                  </div>
                </div>
                <div><label className="text-xs text-stone" htmlFor={`dd-${x.id}`}>Delivery date</label><input id={`dd-${x.id}`} type="date" name="client_delivery_on" defaultValue={x.client_delivery_on ?? ""} className="mt-1 w-full border border-divider bg-paper px-3 py-2 text-sm" /></div>
                <div className="sm:col-span-2"><label className="text-xs text-stone" htmlFor={`rm-${x.id}`}>Note for our team (brand, model, anything we should know)</label><textarea id={`rm-${x.id}`} name="client_remarks" rows={2} defaultValue={x.client_remarks ?? ""} className="mt-1 w-full border border-divider bg-paper px-3 py-2 text-sm" /></div>
                <div className="sm:col-span-2"><Submit className="bg-charcoal px-5 py-2.5 text-sm text-ivory hover:bg-black">Save update</Submit></div>
              </ActionForm>
            </details>
          )}
          {x.client_updated_at && <p className="mt-3 text-xs text-stone">You last updated this on {fmtDate(new Date(x.client_updated_at).toISOString().slice(0, 10))}{x.client_delivery_on ? ` · delivery ${fmtDate(x.client_delivery_on)}` : ""}.</p>}
        </div>
      </div>
    </li>
  );
}

export default async function ClientPurchases() {
  const user = await requireUser("client");
  const data = await withUser(user.id, async (db) => {
    const pid = await clientProjectId(db);
    return pid ? await purchaseList(db, { projectId: pid }) : null;
  });
  if (!data) return <p className="py-20 text-center text-stone">Your project is being set up.</p>;
  const today = todayIST();
  const items = data.filter((x) => x.status !== "cancelled");
  const action = items.filter((x) => x.responsibility !== "company" && ["purchase_required", "client_informed", "delayed"].includes(x.status) || (x.required_delivery_date && x.required_delivery_date < today && !CLOSED.includes(x.status)));
  const onTheWay = items.filter((x) => !action.includes(x) && ["purchased", "delivery_scheduled"].includes(x.status));
  const later = items.filter((x) => !action.includes(x) && x.status === "not_yet_required");
  const done = items.filter((x) => !action.includes(x) && ["delivered", "installed"].includes(x.status));
  const groups: [string, any[]][] = [["Needs your attention", action], ["On the way", onTheWay], ["Needed later", later], ["At site", done]];
  return (
    <>
      <h1 className="font-serif text-5xl">Purchases</h1>
      <p className="mt-4 max-w-xl text-stone">Items you are buying for your home, with the exact size we have planned for and the date they are needed at site. Please update each item as it moves, so our team can plan the installation.</p>
      {items.length === 0 && <p className="mt-16 font-serif text-2xl text-charcoal/70">There is nothing for you to buy at the moment.</p>}
      {groups.map(([title, rows]) => rows.length > 0 && (
        <section key={title} className="mt-14">
          <div className="text-[11px] tracking-[0.25em] text-stone uppercase">{title} · {rows.length}</div>
          <ul className="mt-2 divide-y divide-divider border-y border-divider">{rows.map((x) => <Item key={x.id} x={x} today={today} />)}</ul>
        </section>
      ))}
    </>
  );
}
