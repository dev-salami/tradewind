import "server-only";
import { z } from "zod";
export const SYSTEM_PROMPT = "You are an invoice checker for a trade-finance service. You receive the text of an invoice and optionally a shipping document, plus the fields the seller typed into a form. Extract the fields and run only the listed checks. Do arithmetic exactly. Do not guess missing values: leave them empty and mark the related check as not ok with a note. Reply with JSON matching the schema and nothing else.";
export const CHECK_IDS = ["sum_matches_total", "total_matches_form_face", "buyer_matches_form", "terms_consistent_with_dates", "currency_supported", "shipping_doc_consistent", "no_obvious_tampering_signals"] as const;
export const extractedSchema = z.object({
  invoice_number: z.string(), issue_date: z.string(), due_date: z.string(), payment_terms_days: z.number().int().nonnegative(),
  seller_name: z.string(), buyer_name: z.string(), currency: z.string(), subtotal: z.string(), tax: z.string(), total: z.string(),
  line_items: z.array(z.object({ description: z.string(), qty: z.string(), unit_price: z.string(), amount: z.string() })),
  goods: z.string(), incoterm: z.string(), ports: z.object({ loading: z.string(), discharge: z.string() }),
});
export const checkSchema = z.object({ id: z.enum(CHECK_IDS), ok: z.boolean(), note: z.string() });
export const resultSchema = z.object({ verdict: z.enum(["pass", "warn", "fail"]), extracted: extractedSchema,
  checks: z.array(checkSchema).length(7).refine(c => new Set(c.map(x => x.id)).size === 7, "Missing or duplicate checks"), reasons: z.array(z.string()) });
export const formSchema = z.object({ exporter: z.string().default(""), buyer: z.string().default(""), buyer_label: z.string().default(""), invoice_number: z.string().default(""), face: z.string().regex(/^\d+$/).default("0"), tenor_days: z.number().int().nonnegative().default(60), currency: z.string().default("USDC") });
export type FormFields = z.infer<typeof formSchema>;
export type Extracted = z.infer<typeof extractedSchema>;
export type Check = z.infer<typeof checkSchema>;
export type ModelResult = z.infer<typeof resultSchema>;
// Supply the §11.1 output shape alongside the unchanged §11.2 system prompt.
export const OUTPUT_SHAPE = {
  verdict: "pass | warn | fail",
  extracted: { invoice_number: "", issue_date: "", due_date: "", payment_terms_days: 0, seller_name: "", buyer_name: "", currency: "", subtotal: "", tax: "", total: "", line_items: [{ description: "", qty: "", unit_price: "", amount: "" }], goods: "", incoterm: "", ports: { loading: "", discharge: "" } },
  checks: CHECK_IDS.map(id => ({ id, ok: true, note: "" })), reasons: ["short plain sentences"],
};
export function userMessage(form: FormFields, text: string, shipping?: string) {
  return `FORM_FIELDS\n${JSON.stringify(form)}\nINVOICE_TEXT\n${text}${shipping ? `\nSHIPPING_DOC_TEXT\n${shipping}` : ""}`;
}
