"use client";

import Link from "next/link";
import { useAccount } from "wagmi";

import { EmptyState, PrivacyBadge, StatusBadge } from "@/components/common";
import { RequireWallet } from "@/components/wallet";
import { Alert, Badge, Card, Spinner } from "@/components/ui/primitives";
import { formatTokenAmount, useFxrpMetadata } from "@/hooks/use-fxrp";
import {
  mergeInvoiceIds,
  useBuyerInvoiceIds,
  useInvoices,
  useSellerInvoiceIds,
} from "@/hooks/use-invoices";
import { isEscrowConfigured } from "@/lib/env";
import { formatCentsAsCurrency } from "@/lib/invoice";
import { formatDate } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Every invoice where you are the seller or the buyer.
        </p>
      </div>

      {!isEscrowConfigured ? (
        <Alert tone="warning" title="Escrow not configured">
          Set <code className="font-mono text-xs">NEXT_PUBLIC_ESCROW_ADDRESS</code> to a deployed
          Coston2 escrow to load invoices.
        </Alert>
      ) : (
        <RequireWallet>
          <InvoiceList />
        </RequireWallet>
      )}
    </div>
  );
}

function InvoiceList() {
  const { address } = useAccount();
  const seller = useSellerInvoiceIds(address);
  const buyer = useBuyerInvoiceIds(address);

  const ids = mergeInvoiceIds(
    seller.data as readonly bigint[] | undefined,
    buyer.data as readonly bigint[] | undefined,
  );

  const { invoices, isLoading, isError, error } = useInvoices(ids);
  const { symbol, decimals } = useFxrpMetadata();

  const sellerIds = new Set((seller.data as readonly bigint[] | undefined) ?? []);
  const buyerIds = new Set((buyer.data as readonly bigint[] | undefined) ?? []);

  if (seller.isLoading || buyer.isLoading || (ids.length > 0 && isLoading)) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border p-10 text-sm text-muted-foreground">
        <Spinner /> Loading invoices…
      </div>
    );
  }

  if (seller.isError || buyer.isError || isError) {
    const detail = seller.error ?? buyer.error ?? error;
    return (
      <Alert tone="danger" title="Could not reach the Coston2 RPC">
        {detail instanceof Error ? detail.message : "The invoice list could not be loaded."}
      </Alert>
    );
  }

  if (ids.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        action={{ href: "/invoices/new", label: "Create your first invoice" }}
      >
        Invoices you issue or receive will appear here.
      </EmptyState>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">{symbol}</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Privacy</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => {
              const isSeller = sellerIds.has(invoice.id);
              const isBuyer = buyerIds.has(invoice.id);

              return (
                <tr key={invoice.id.toString()} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{invoice.id.toString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {isSeller ? <Badge variant="default">Seller</Badge> : null}
                      {isBuyer ? <Badge variant="neutral">Buyer</Badge> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {formatCentsAsCurrency(invoice.usdAmountCents)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {invoice.fxrpAmount > 0n && decimals !== undefined
                      ? formatTokenAmount(invoice.fxrpAmount, decimals)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(invoice.dueAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={invoice.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PrivacyBadge confidential={invoice.confidential} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Details →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
