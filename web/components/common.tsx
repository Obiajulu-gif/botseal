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
      className="font-mono text-xs text-primary hover:underline"
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
      className="font-mono text-xs text-primary hover:underline"
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
    <div className="grid grid-cols-1 gap-1 border-b border-border py-3 last:border-0 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`sm:col-span-2 ${mono ? "hex" : "text-sm"}`}>{children}</dd>
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
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="mt-1 text-sm text-muted-foreground">{children}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
