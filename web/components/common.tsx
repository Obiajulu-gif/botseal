"use client";

/**
 * Small presentational pieces shared across pages: hash links, status badges, and the labelled
 * key/value rows used on the invoice detail view.
 */

import Link from "next/link";

import { InvoiceStatus, invoiceStatusLabel } from "@/lib/contracts";
import { addressUrl, shortenHex, txUrl } from "@/lib/explorer";
import { Badge, type BadgeProps } from "@/components/ui/primitives";

export function AddressLink({ address, full = false }: { address: string; full?: boolean }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-primary transition-colors hover:text-[#ff9678] hover:underline"
    >
      {full ? address : shortenHex(address)}
    </a>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a
      href={txUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-primary transition-colors hover:text-[#ff9678] hover:underline"
    >
      {label ?? shortenHex(hash, 10, 8)}
    </a>
  );
}

const STATUS_TONE: Record<number, BadgeProps["variant"]> = {
  [InvoiceStatus.Pending]: "warning",
  [InvoiceStatus.Funded]: "default",
  [InvoiceStatus.Released]: "success",
  [InvoiceStatus.Refunded]: "neutral",
  [InvoiceStatus.Cancelled]: "neutral",
};

export function StatusBadge({ status }: { status: number }) {
  return <Badge variant={STATUS_TONE[status] ?? "neutral"}>{invoiceStatusLabel(status)}</Badge>;
}

export function PrivacyBadge({ confidential }: { confidential: boolean }) {
  return confidential ? (
    <Badge variant="success">Confidential</Badge>
  ) : (
    <Badge variant="warning">Public fallback</Badge>
  );
}

/** A labelled row on a detail panel. `mono` is for hashes and addresses. */
export function DetailRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-white/[0.06] py-3.5 last:border-0 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-foreground/45">{label}</dt>
      <dd className={`sm:col-span-2 ${mono ? "hex" : "text-sm"}`}>{children}</dd>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-5 border-b border-white/[0.07] pb-7 sm:flex-row sm:items-end">
      <div className="max-w-3xl">
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/60">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className="glass-panel rounded-2xl border border-dashed border-white/10 p-12 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <p className="mt-2 text-sm text-foreground/60">{children}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-5 inline-block rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_12px_35px_hsl(var(--primary)/0.22)] transition-transform hover:-translate-y-0.5"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
