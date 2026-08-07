"use client";

/**
 * Invoice detail. Renders only what the contract stores — which is, by construction, only public
 * data. There is no plaintext line item to show, because none was ever submitted.
 */

import Link from "next/link";
import { use } from "react";
import { useAccount } from "wagmi";

import {
  AddressLink,
  DetailRow,
  EmptyState,
  PageHeader,
  PrivacyBadge,
  StatusBadge,
} from "@/components/common";
import { ConnectButton } from "@/components/wallet";
import {
  Alert,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@/components/ui/primitives";
import { formatTokenAmount, useFxrpMetadata } from "@/hooks/use-fxrp";
import { useInvoice, useIsBuyer, useIsSeller, useSettlementActions } from "@/hooks/use-invoices";
import { InvoiceStatus, ZERO_BYTES32, type Invoice } from "@/lib/contracts";
import { env, isEscrowConfigured } from "@/lib/env";
import { addressUrl } from "@/lib/explorer";
import { formatCentsAsCurrency } from "@/lib/invoice";
import { formatTimestamp, formatWeiPrice } from "@/lib/utils";

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  if (!/^\d+$/.test(id)) {
    return <EmptyState title="Invalid invoice id">The invoice id must be a number.</EmptyState>;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="On-chain settlement record"
        title={`Invoice #${id}`}
        description="Inspect the public proof, escrow state, and settlement actions. Confidential line items never appear here."
        action={
          <Link
            href="/dashboard"
            className="text-sm font-medium text-primary transition-colors hover:text-[#ff9678]"
          >
            ← Back to dashboard
          </Link>
        }
      />

      {!isEscrowConfigured ? (
        <Alert tone="warning" title="Escrow not configured">
          Set <code className="font-mono text-xs">NEXT_PUBLIC_ESCROW_ADDRESS</code> to load this
          invoice.
        </Alert>
      ) : (
        // Deliberately NOT wrapped in RequireWallet. Everything this page renders is public
        // on-chain state, so a reviewer following a link should see the record immediately
        // rather than a connect-wallet prompt. Only the settlement actions need a signer, and
        // ActionsPanel gates itself on that.
        <InvoiceDetail invoiceId={BigInt(id)} />
      )}
    </div>
  );
}

function InvoiceDetail({ invoiceId }: { invoiceId: bigint }) {
  const { data, isLoading, isError } = useInvoice(invoiceId);
  const { symbol, decimals } = useFxrpMetadata();

  if (isLoading) {
    return (
      <div className="glass-panel flex items-center gap-3 rounded-2xl border border-white/[0.08] p-10 text-sm text-foreground/60">
        <Spinner /> Loading invoice…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState title="Invoice not found">
        No invoice with id {invoiceId.toString()} exists in this escrow.
      </EmptyState>
    );
  }

  const invoice = data as unknown as Invoice;
  const hasFxrp = invoice.fxrpAmount > 0n && decimals !== undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Invoice record</CardTitle>
            <StatusBadge status={invoice.status} />
            <PrivacyBadge confidential={invoice.confidential} />
          </div>
          <CardDescription>
            {invoice.confidential
              ? "Created from a TEE-signed result. Line items were never on-chain."
              : "Created through the public fallback path — the commitment is unverified."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl>
            <DetailRow label="Invoice id">{invoice.id.toString()}</DetailRow>
            <DetailRow label="Seller">
              <AddressLink address={invoice.seller} full />
            </DetailRow>
            <DetailRow label="Buyer">
              <AddressLink address={invoice.buyer} full />
            </DetailRow>
            <DetailRow label="Amount due">
              <span className="text-base font-semibold">
                {formatCentsAsCurrency(invoice.usdAmountCents)}
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                ({invoice.usdAmountCents.toString()} cents)
              </span>
            </DetailRow>
            <DetailRow label="Due">{formatTimestamp(invoice.dueAt)}</DetailRow>
            <DetailRow label="Terms commitment" mono>
              {invoice.termsCommitment}
            </DetailRow>
            <DetailRow label="FCC action id" mono>
              {invoice.fccActionId === ZERO_BYTES32 ? (
                <span className="text-sm text-muted-foreground">
                  None — this invoice did not come from the TEE.
                </span>
              ) : (
                invoice.fccActionId
              )}
            </DetailRow>
            <DetailRow label={`${symbol} escrowed`}>
              {hasFxrp ? formatTokenAmount(invoice.fxrpAmount, decimals) : "—"}
            </DetailRow>
            <DetailRow label="Funding XRP/USD">
              {invoice.xrpUsdPriceWei > 0n ? `$${formatWeiPrice(invoice.xrpUsdPriceWei)}` : "—"}
            </DetailRow>
            <DetailRow label="Created">{formatTimestamp(invoice.createdAt)}</DetailRow>
            <DetailRow label="Funded">{formatTimestamp(invoice.fundedAt)}</DetailRow>
            <DetailRow label="Settled">{formatTimestamp(invoice.settledAt)}</DetailRow>
            <DetailRow label="Escrow contract">
              {env.escrowAddress ? <AddressLink address={env.escrowAddress} full /> : "—"}
            </DetailRow>
          </dl>
        </CardContent>
      </Card>

      <aside className="space-y-6">
        <ActionsPanel invoice={invoice} />
        <Card>
          <CardHeader>
            <CardTitle>Verify on-chain</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {env.escrowAddress ? (
              <a
                href={addressUrl(env.escrowAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Escrow contract on Coston2 explorer ↗
              </a>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Read the invoice storage directly to confirm no plaintext line items are present.
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function ActionsPanel({ invoice }: { invoice: Invoice }) {
  const { address } = useAccount();
  const isBuyer = useIsBuyer(invoice);
  const isSeller = useIsSeller(invoice);
  const actions = useSettlementActions(invoice.id);

  const now = Math.floor(Date.now() / 1000);
  const expiredRefundAvailable =
    invoice.status === InvoiceStatus.Funded && now > Number(invoice.dueAt);

  // Disconnected visitors still see the full record above; only the actions need a signer.
  if (!address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>
            Connect the seller or buyer wallet to fund, release, refund, or cancel this invoice.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectButton />
        </CardContent>
      </Card>
    );
  }

  if (!isBuyer && !isSeller) {
    return (
      <Alert tone="info" title="Read-only">
        You are neither the seller nor the buyer on this invoice.
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>{isSeller ? "You are the seller." : "You are the buyer."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invoice.status === InvoiceStatus.Pending && isBuyer ? (
          <Link href={`/pay/${invoice.id}`} className={buttonVariants({ className: "w-full" })}>
            Fund this invoice
          </Link>
        ) : null}

        {invoice.status === InvoiceStatus.Pending && isSeller ? (
          <Button
            variant="outline"
            className="w-full"
            disabled={actions.isPending}
            onClick={() => actions.cancel()}
          >
            Cancel invoice
          </Button>
        ) : null}

        {invoice.status === InvoiceStatus.Funded && isBuyer ? (
          <Button
            className="w-full"
            disabled={actions.isPending}
            onClick={() => actions.release()}
          >
            {actions.isPending ? <Spinner /> : null}
            Release payment to seller
          </Button>
        ) : null}

        {invoice.status === InvoiceStatus.Funded && isSeller ? (
          <Button
            variant="outline"
            className="w-full"
            disabled={actions.isPending}
            onClick={() => actions.refund()}
          >
            Refund the buyer
          </Button>
        ) : null}

        {invoice.status === InvoiceStatus.Funded && isBuyer ? (
          <div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={actions.isPending || !expiredRefundAvailable}
              onClick={() => actions.claimExpired()}
            >
              Reclaim expired escrow
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Available only after the due date plus the contract&apos;s refund grace period. The
              contract enforces the exact window.
            </p>
          </div>
        ) : null}

        {invoice.status !== InvoiceStatus.Pending && invoice.status !== InvoiceStatus.Funded ? (
          <p className="text-sm text-muted-foreground">
            This invoice is settled. No further actions are available.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
