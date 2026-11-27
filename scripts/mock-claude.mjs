// Local testing only: a stand-in for the Claude API that "reads" the sample
// quotation (scripts/fixtures/sample-quotation.pdf). Start the app with
// ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=test to use it.
import http from "node:http";

const items = [
  ["Living Room", "TV unit with back panel, laminate finish", 48, "sq ft", 1450],
  ["Living Room", "False ceiling with cove lighting", 220, "sq ft", 95],
  ["Living Room", "Shoe rack", 1, "nos", 18500],
  ["Master Bedroom", "Sliding wardrobe with loft, 18mm BWP ply", 96, "sq ft", 1650],
  ["Master Bedroom", "King bed with hydraulic storage", 1, "nos", 62000],
  ["Master Bedroom", "Side tables", 2, "nos", 8500],
  ["Kitchen", "Modular kitchen, acrylic shutters, Hettich fittings", 140, "rft", 3200],
  ["Kitchen", "Quartz countertop", 28, "rft", 2400],
].map(([section, description, quantity, unit, rate]) => ({ section, description, quantity, unit, rate, amount: quantity * rate }));
const subtotal = items.reduce((s, i) => s + i.amount, 0);
const answer = {
  is_quotation: true, quote_number: "SQ-2026-041", quote_date: "2026-11-20", client_name: "Mr. Amit Kulkarni",
  title: "Interior quotation – 3 BHK, Baner", items, subtotal, discount: null, tax_amount: 155088, tax_label: "GST @ 18%",
  grand_total: 1016688, notes: "",
};

const PORT = Number(process.env.PORT ?? 4010);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "no" } });
    const r = JSON.parse(body);
    const doc = r.messages?.[0]?.content?.find((b) => b.type === "document");
    const pdf = doc ? Buffer.from(doc.source.data, "base64").toString("latin1") : "";
    console.log(`[mock-claude] model=${r.model} effort=${r.output_config?.effort} format=${r.output_config?.format?.type} fallbacks=${JSON.stringify(r.fallbacks)} beta=${req.headers["anthropic-beta"]} pdf=${pdf.length}B`);
    if (!pdf.startsWith("%PDF") || r.output_config?.format?.type !== "json_schema") return send(400, { type: "error", error: { type: "invalid_request_error", message: "bad request" } });
    if (process.env.MOCK_NO_CREDIT) return send(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } });
    const out = process.env.MOCK_NOT_QUOTE ? { ...answer, is_quotation: false, items: [] } : answer;
    setTimeout(() => send(200, {
      id: "msg_mock", type: "message", role: "assistant", model: r.model, stop_reason: "end_turn", stop_sequence: null,
      content: [{ type: "text", text: JSON.stringify(out) }], usage: { input_tokens: 1000, output_tokens: 800 },
    }), 1500);
  });
}).listen(PORT, () => console.log(`[mock-claude] listening on ${PORT}`));
