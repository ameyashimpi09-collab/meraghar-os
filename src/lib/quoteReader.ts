import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

// Reads a quotation PDF with Claude and returns its line items and totals.
// Nothing is saved here: the result is shown to management to check first.

export const QUOTE_MODEL = "claude-opus-5-5";

const Item = z.object({
  section: z.string().nullable().describe("Room / area / heading the line sits under on the quotation, e.g. 'Master Bedroom'. Null if none."),
  description: z.string().describe("Item name and its key description as written, e.g. 'Wardrobe with loft, 18mm BWP ply, laminate finish'."),
  unit: z.string().nullable().describe("Unit as written, e.g. 'sq ft', 'rft', 'nos', 'lump sum'. Null if none."),
  quantity: z.number().nullable().describe("Quantity as a plain number. Null if not given."),
  rate: z.number().nullable().describe("Rate per unit in rupees as a plain number (no commas or symbols). Null if not given."),
  amount: z.number().describe("Line total in rupees as a plain number."),
});

const Quote = z.object({
  is_quotation: z.boolean().describe("False if this document is clearly not a quotation / estimate / proforma with priced items."),
  quote_number: z.string().nullable(),
  quote_date: z.string().nullable().describe("Date of the quotation as YYYY-MM-DD. Null if not shown."),
  client_name: z.string().nullable(),
  title: z.string().nullable().describe("Short title, e.g. 'Interior quotation – 3 BHK, Baner'."),
  items: z.array(Item),
  subtotal: z.number().nullable().describe("Total before discount and tax, in rupees, if printed."),
  discount: z.number().nullable().describe("Discount amount in rupees (positive number), if any."),
  tax_amount: z.number().nullable().describe("Total GST / tax amount in rupees, if printed."),
  tax_label: z.string().nullable().describe("e.g. 'GST 18%'."),
  grand_total: z.number().nullable().describe("Final grand total payable in rupees, exactly as printed."),
  notes: z.string().describe("One or two short sentences for the manager about anything unclear: unreadable numbers, totals that don't add up, optional items. Empty string if all clear."),
});
export type ReadQuote = z.infer<typeof Quote>;

const INSTRUCTIONS = `This is a quotation from an interior design firm in India (amounts in Indian rupees).
Read every priced line item in the order it appears, across all pages, and the totals.

Rules:
- Copy item names and descriptions as written; keep them short (one line, max ~200 characters).
- Numbers are plain numbers in rupees: "1,25,000" is 125000, "₹ 4,500.50" is 4500.5.
- Put a line under the room / area heading it appears under (section). Do not output headings, subtotal rows, tax rows or total rows as items.
- If a line shows only a lump-sum amount, put the amount and leave quantity and rate null.
- grand_total is the final amount payable as printed on the quotation (after discount and tax). Never invent it: if no grand total is printed, give null.
- Optional or alternative items that are not included in the total: leave them out and mention them in notes.
- If something is unreadable, give your best reading and say so in notes.`;

export class QuoteReadError extends Error {}

export const UNAVAILABLE = "Automatic reading unavailable: AI credits not available";
const creditProblem = (msg: string) => /credit balance|billing|purchase credits|insufficient|quota|spend limit/i.test(msg);

export function quoteReaderConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function readQuotationPdf(pdf: Buffer): Promise<ReadQuote> {
  if (!quoteReaderConfigured()) {
    throw new QuoteReadError(`${UNAVAILABLE} (the Claude API key has not been added yet). Please enter the lines by hand below.`);
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), timeout: 170_000, maxRetries: 1 });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: QUOTE_MODEL,
      max_tokens: 20000,
      // If the model ever declines, the request is answered by a fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Quote) },
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: INSTRUCTIONS },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError && creditProblem(e.message ?? "")) {
      throw new QuoteReadError(`${UNAVAILABLE} (the Claude account has run out of credit). Please enter the lines by hand below, and top up credits at console.anthropic.com.`);
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new QuoteReadError(`${UNAVAILABLE} (the Claude API key was not accepted). Please enter the lines by hand below.`);
    }
    if (e instanceof Anthropic.RateLimitError) throw new QuoteReadError("Too many quotations are being read right now. Please try again in a minute.");
    if (e instanceof Anthropic.BadRequestError) {
      console.error("quote read bad request", e.message);
      throw new QuoteReadError("This PDF could not be read. If it is password-protected or a scanned photo, try exporting it again as a normal PDF.");
    }
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new QuoteReadError("Reading the quotation took too long. Please try again.");
    if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
      console.error("quote read failed", e);
      throw new QuoteReadError("The reading service is not reachable right now. Please try again in a few minutes.");
    }
    throw e;
  }
  if (res.stop_reason === "refusal") throw new QuoteReadError("This document could not be read automatically. Please enter the quotation by hand.");
  if (res.stop_reason === "max_tokens") throw new QuoteReadError("This quotation is too long to read in one go. Please split the PDF into parts, or enter it by hand.");
  const out = res.parsed_output;
  if (!out) throw new QuoteReadError("The quotation could not be read. Please try again or enter it by hand.");
  if (!out.is_quotation || out.items.length === 0) {
    throw new QuoteReadError("This PDF doesn't look like a quotation with priced items. Please check you picked the right file.");
  }
  return out;
}
