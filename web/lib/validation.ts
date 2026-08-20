/**
 * Zod schema for the new-invoice form.
 *
 * Mirrors the attestor's validation rules so the user gets immediate feedback, but the attestor remains
 * authoritative: it revalidates everything on the decrypted payload and the escrow only ever trusts
 * the attestor's signed result.
 */

import { isAddress } from "viem";
import { z } from "zod";

import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DUE_DATE_HORIZON_SECONDS,
  MAX_ITEMS,
  MAX_REFERENCE_LENGTH,
  MIN_ITEMS,
  MoneyParseError,
  parseQuantity,
  parseUsdToCents,
} from "./invoice";

/** Validates a money string through the same parser used for the real arithmetic. */
function moneyField(options: { required: boolean }) {
  return z.string().superRefine((value, ctx) => {
    if (!options.required && value.trim() === "") return;
    try {
      parseUsdToCents(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof MoneyParseError ? error.message : "invalid amount",
      });
    }
  });
}

export const lineItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "description is required")
    .max(MAX_DESCRIPTION_LENGTH, `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`),
  quantity: z.string().superRefine((value, ctx) => {
    try {
      parseQuantity(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof MoneyParseError ? error.message : "invalid quantity",
      });
    }
  }),
  unitPriceUsd: moneyField({ required: true }).superRefine((value, ctx) => {
    try {
      if (parseUsdToCents(value) <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "unit price must be greater than zero",
        });
      }
    } catch {
      // The base parser already reported the format problem.
    }
  }),
});

export const invoiceFormSchema = z
  .object({
    // `superRefine` rather than `refine`: viem's `isAddress` is a type guard, and `refine` would
    // narrow this field to `0x${string}`, which the form's empty default value cannot satisfy.
    buyer: z.string().superRefine((value, ctx) => {
      if (!isAddress(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "buyer must be a valid EVM address",
        });
      }
    }),
    invoiceReference: z
      .string()
      .trim()
      .min(1, "reference is required")
      .max(MAX_REFERENCE_LENGTH, `reference must be at most ${MAX_REFERENCE_LENGTH} characters`),
    dueDate: z.string().min(1, "due date is required"),
    items: z.array(lineItemSchema).min(MIN_ITEMS, "add at least one line item").max(MAX_ITEMS),
    taxUsd: moneyField({ required: false }),
    discountUsd: moneyField({ required: false }),
  })
  .superRefine((form, ctx) => {
    const dueAt = dueDateToUnix(form.dueDate);
    const now = Math.floor(Date.now() / 1000);

    if (dueAt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueDate"],
        message: "due date is not a valid date",
      });
      return;
    }
    if (dueAt <= now) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueDate"],
        message: "due date must be in the future",
      });
    }
    if (dueAt > now + MAX_DUE_DATE_HORIZON_SECONDS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueDate"],
        message: "due date must be within 366 days",
      });
    }
  });

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

/**
 * Converts an `<input type="date">` value to a unix timestamp.
 *
 * The date is interpreted as end-of-day UTC so an invoice due "today" in the user's timezone does
 * not arrive at the attestor already expired.
 */
export function dueDateToUnix(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T23:59:59Z`);
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

/** The earliest date the picker should allow: tomorrow, in `YYYY-MM-DD`. */
export function minimumDueDate(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return tomorrow.toISOString().slice(0, 10);
}

/** The latest date the picker should allow, matching the attestor's 366-day horizon. */
export function maximumDueDate(): string {
  const horizon = new Date(Date.now() + MAX_DUE_DATE_HORIZON_SECONDS * 1000);
  return horizon.toISOString().slice(0, 10);
}
