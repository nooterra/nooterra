/**
 * Money type — amount + currency with safe arithmetic.
 * Never use floating point for money. Store as integer cents.
 */

import { z } from 'zod';

export const MoneySchema = z.object({
  /** Amount in smallest currency unit (cents for USD) */
  amountCents: z.number().int(),
  /** ISO 4217 currency code */
  currency: z.string().length(3).default('USD'),
});

export type Money = z.infer<typeof MoneySchema>;

export function money(amountCents: number, currency = 'USD'): Money {
  return { amountCents: Math.round(amountCents), currency };
}

export function moneyFromDollars(dollars: number, currency = 'USD'): Money {
  return { amountCents: Math.round(dollars * 100), currency };
}

export function toDollars(m: Money): number {
  return m.amountCents / 100;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return { amountCents: a.amountCents + b.amountCents, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return { amountCents: a.amountCents - b.amountCents, currency: a.currency };
}

export function isPositive(m: Money): boolean {
  return m.amountCents > 0;
}

export function isZeroOrNegative(m: Money): boolean {
  return m.amountCents <= 0;
}

export function formatMoney(m: Money): string {
  const dollars = Math.abs(m.amountCents) / 100;
  const sign = m.amountCents < 0 ? '-' : '';
  return `${sign}$${dollars.toFixed(2)} ${m.currency}`;
}
