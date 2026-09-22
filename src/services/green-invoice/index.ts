import { z } from "zod";
import type { ServiceModule } from "../types.js";
import { ok, run } from "../../lib/result.js";
import { GreenInvoiceClient } from "./client.js";

/**
 * Green Invoice (Morning) — Israeli invoicing and bookkeeping.
 * Requires GREENINVOICE_API_ID + GREENINVOICE_API_SECRET.
 * Write tools (document creation) require GREENINVOICE_ALLOW_WRITE=true, because documents
 * issued in production are legally binding and cannot be deleted — only cancelled with a credit note.
 */

export const DOCUMENT_TYPES = {
  10: "Price quote (הצעת מחיר)",
  100: "Order (הזמנה)",
  200: "Delivery note (תעודת משלוח)",
  210: "Return delivery note (תעודת החזרה)",
  300: "Transaction account (חשבון עסקה)",
  305: "Tax invoice (חשבונית מס)",
  320: "Tax invoice + receipt (חשבונית מס קבלה)",
  330: "Credit invoice (חשבונית זיכוי)",
  400: "Receipt (קבלה)",
  405: "Donation receipt (קבלה על תרומה)",
  500: "Purchase order (הזמנת רכש)",
  600: "Deposit receipt (קבלת פיקדון)",
  610: "Deposit withdrawal (משיכת פיקדון)",
} as const;

export const DOCUMENT_STATUSES = { 0: "Open", 1: "Closed", 2: "Manually closed", 3: "Canceling", 4: "Canceled" } as const;

export const PAYMENT_TYPES = {
  [-1]: "Unpaid",
  0: "Deduction at source (ניכוי במקור)",
  1: "Cash",
  2: "Check",
  3: "Credit card",
  4: "Bank transfer",
  5: "PayPal",
  10: "Payment app (Bit, PayBox...)",
  11: "Other",
} as const;

/** Document types that the API rejects without a payment array. */
export const TYPES_REQUIRING_PAYMENT = new Set([320, 400, 405]);

const codeList = (m: Record<number, string>) =>
  Object.entries(m)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

const DOC_TYPE = z
  .number()
  .int()
  .refine((n) => n in DOCUMENT_TYPES, "Unknown document type code")
  .describe(`Document type code: ${codeList(DOCUMENT_TYPES)}`);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

function summarizeDocument(d: any) {
  return {
    id: d.id,
    number: d.number,
    type: d.type,
    typeName: DOCUMENT_TYPES[d.type as keyof typeof DOCUMENT_TYPES],
    status: d.status,
    statusName: DOCUMENT_STATUSES[d.status as keyof typeof DOCUMENT_STATUSES],
    date: d.documentDate ?? d.date,
    client: d.client?.name,
    amount: d.amount,
    currency: d.currency,
    description: d.description,
  };
}

const createDocumentShape = {
  type: DOC_TYPE,
  client: z.object({
    name: z.string().min(1),
    emails: z.array(z.string().email()).optional().describe("Required if sendEmail is true"),
    taxId: z.string().optional().describe("ח.פ / ע.מ / ת.ז"),
    id: z.string().optional().describe("Existing client id (from gi_search_clients). Preferred over creating a new client."),
    add: z.boolean().default(false).describe("Create the client in Green Invoice if it does not exist"),
  }),
  income: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive().default(1),
        price: z.number().describe("Unit price"),
        currency: z.string().length(3).default("ILS"),
        vatType: z.number().int().min(0).max(2).default(0).describe("0=price before VAT, 1=VAT included, 2=VAT exempt"),
      }),
    )
    .min(1),
  payment: z
    .array(
      z.object({
        type: z.number().int().describe(`Payment type: ${codeList(PAYMENT_TYPES)}`),
        date: DATE.describe("Cannot be in the future for receipt types"),
        price: z.number(),
        currency: z.string().length(3).default("ILS"),
      }),
    )
    .optional()
    .describe("Required for types 320, 400, 405"),
  date: DATE.optional().describe("Document date, defaults to today"),
  dueDate: DATE.optional(),
  lang: z.enum(["he", "en"]).default("he"),
  currency: z.string().length(3).default("ILS"),
  description: z.string().optional().describe("Document title/subject"),
  remarks: z.string().optional(),
  sendEmail: z.boolean().default(false).describe("Email the PDF to client.emails"),
  dryRun: z
    .boolean()
    .default(true)
    .describe("true = validate via the preview endpoint without issuing anything. Set false only after the user confirmed."),
};

export const greenInvoice: ServiceModule = {
  id: "gi",
  name: "Green Invoice (Morning)",

  disabledReason(config) {
    const { apiId, apiSecret } = config.greenInvoice;
    return apiId && apiSecret ? null : "GREENINVOICE_API_ID / GREENINVOICE_API_SECRET not set";
  },

  register(server, config) {
    const gi = new GreenInvoiceClient(
      config.greenInvoice.apiId!,
      config.greenInvoice.apiSecret!,
      config.greenInvoice.env,
      config.httpTimeoutMs,
    );
    const env = gi.env;

    server.registerTool(
      "gi_business_info",
      {
        title: "Green Invoice: current business",
        description: "Details of the connected business (name, type such as עוסק פטור/מורשה/חברה, tax id). " +
          "Call first when unsure which document types the business may issue.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async () =>
        run(async () => {
          const b = await gi.get("/businesses/me");
          return ok({ environment: env, business: b });
        }),
    );

    server.registerTool(
      "gi_search_documents",
      {
        title: "Green Invoice: search documents",
        description: "Search invoices, receipts, quotes and other documents by date range, type, status, client or number.",
        inputSchema: {
          fromDate: DATE.optional(),
          toDate: DATE.optional(),
          types: z.array(DOC_TYPE).optional(),
          statuses: z.array(z.number().int().min(0).max(4)).optional().describe(`Status codes: ${codeList(DOCUMENT_STATUSES)}`),
          clientName: z.string().optional(),
          number: z.string().optional().describe("Document number"),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ fromDate, toDate, types, statuses, clientName, number, page, pageSize }) =>
        run(async () => {
          const r = await gi.post("/documents/search", {
            page,
            pageSize,
            fromDate,
            toDate,
            type: types,
            status: statuses,
            clientName,
            number,
          });
          return ok({
            environment: env,
            total: r?.total,
            page: r?.page ?? page,
            documents: (r?.items ?? []).map(summarizeDocument),
          });
        }),
    );

    server.registerTool(
      "gi_get_document",
      {
        title: "Green Invoice: get document",
        description: "Full details of one document, optionally with PDF download links (Hebrew / English / original).",
        inputSchema: {
          id: z.string().min(1),
          includeDownloadLinks: z.boolean().default(true),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ id, includeDownloadLinks }) =>
        run(async () => {
          const safeId = encodeURIComponent(id);
          const document = await gi.get(`/documents/${safeId}`);
          const downloadLinks = includeDownloadLinks ? await gi.get(`/documents/${safeId}/download/links`) : undefined;
          return ok({ environment: env, document, downloadLinks });
        }),
    );

    server.registerTool(
      "gi_search_clients",
      {
        title: "Green Invoice: search clients",
        description: "Find clients by name, email or tax id. Use the returned id when creating documents.",
        inputSchema: {
          name: z.string().optional(),
          email: z.string().optional(),
          taxId: z.string().optional(),
          active: z.boolean().optional(),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(25),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args) =>
        run(async () => {
          const r = await gi.post("/clients/search", args);
          return ok({
            environment: env,
            total: r?.total,
            clients: (r?.items ?? []).map((c: any) => ({
              id: c.id,
              name: c.name,
              emails: c.emails,
              taxId: c.taxId,
              active: c.active,
              balance: c.balance,
            })),
          });
        }),
    );

    if (!config.greenInvoice.allowWrite) return;

    server.registerTool(
      "gi_create_document",
      {
        title: "Green Invoice: create document",
        description:
          "Create an invoice, receipt, quote or other document. Defaults to dryRun=true, which validates the " +
          "payload via the preview endpoint without issuing anything. In production an issued document is legally " +
          "binding and cannot be deleted, only cancelled with a credit invoice (330) — always show the user the " +
          "final details and get explicit confirmation before calling with dryRun=false. " +
          "Business-type rules: עוסק פטור cannot issue 305; use 320 or 400.",
        inputSchema: createDocumentShape,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async (args) =>
        run(async () => {
          if (TYPES_REQUIRING_PAYMENT.has(args.type) && !args.payment?.length) {
            throw new Error(`Document type ${args.type} requires a payment array`);
          }
          if (args.sendEmail && !args.client.emails?.length) {
            throw new Error("sendEmail=true requires client.emails");
          }

          const body = {
            type: args.type,
            date: args.date,
            dueDate: args.dueDate,
            lang: args.lang,
            currency: args.currency,
            vatType: 0,
            rounding: false,
            signed: true,
            attachment: args.sendEmail,
            description: args.description,
            remarks: args.remarks,
            client: args.client,
            income: args.income,
            payment: args.payment,
          };

          if (args.dryRun) {
            const preview = await gi.post("/documents/preview", body);
            return ok({
              environment: env,
              dryRun: true,
              valid: true,
              previewPdfBytes: typeof preview?.file === "string" ? Math.floor((preview.file.length * 3) / 4) : undefined,
              wouldIssue: { type: DOCUMENT_TYPES[args.type as keyof typeof DOCUMENT_TYPES], client: args.client.name, income: args.income },
              next: "Show the details to the user and call again with dryRun=false after explicit confirmation.",
            });
          }

          const created = await gi.post("/documents", body);
          return ok({ environment: env, dryRun: false, created });
        }),
    );
  },
};
