"use client";

/**
 * Buyer payment flow.
 *
 * The quote is a simulation of the contract's own `quoteInvoice`, so the number shown is the number
 * the contract computes. It is never passed back in: `fundInvoice` re-reads FTSOv2 on-chain and the
 * only value this page supplies is `maxFxrpAmount`, a ceiling that can make funding fail but can
 * never make it cost more.
 */

import Link from "next/link";
import { use, useState } from "react";
import { useAccount } from "wagmi";

import { AddressLink, StatusBadge } from "@/components/common";
import { RequireWallet } from "@/components/wallet";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
} from "@/components/ui/primitives";
import {
  formatTokenAmount,
  useApproveFxrp,
  useFxrpAllowance,
  useFxrpBalance,
  useFxrpMetadata,
  useInvoiceQuote,
} from "@/hooks/use-fxrp";
import { useInvoice, useSettlementActions } from "@/hooks/use-invoices";
import { InvoiceStatus, type Invoice } from "@/lib/contracts";
import { isEscrowConfigured } from "@/lib/env";
import { applySlippage, SLIPPAGE_OPTIONS } from "@/lib/fcc";
import { formatCentsAsCurrency } from "@/lib/invoice";
import { formatAge, formatTimestamp, formatWeiPrice } from "@/lib/utils";

export default function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  if (!/^\d+$/.test(id)) {
    return (
      <Alert tone="danger" title="Invalid invoice id">
        The invoice id must be a number.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pay invoice #{id}</h1>
          <p className="text-sm text-muted-foreground">
            Priced in FXRP at the live FTSOv2 XRP/USD rate.
          </p>
        </div>
        <Link href={`/invoices/${id}`} className="text-sm text-primary hover:underline">
          View invoice details →
        </Link>
      </div>

      {!isEscrowConfigured ? (
        <Alert tone="warning" title="Escrow not configured">
          Set <code className="font-mono text-xs">NEXT_PUBLIC_ESCROW_ADDRESS</code> to continue.
        </Alert>
      ) : (
        <RequireWallet>
          <PayFlow invoiceId={BigInt(id)} />
        </RequireWallet>
      )}
    </div>
  );
}

function PayFlow({ invoiceId }: { invoiceId: bigint }) {
  const { address } = useAccount();
  const { data, isLoading } = useInvoice(invoiceId);
  const invoice = data as unknown as Invoice | undefined;

  const { symbol, decimals } = useFxrpMetadata();
  const balance = useFxrpBalance(address);
  const allowance = useFxrpAllowance(address);
  const approve = useApproveFxrp();
  const actions = useSettlementActions(invoiceId);

  const [slippageBps, setSlippageBps] = useState<bigint>(SLIPPAGE_OPTIONS[1].bps);

  const isPending = invoice?.status === InvoiceStatus.Pending;
  const quote = useInvoiceQuote(invoiceId, isPending);

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border p-10 text-sm text-muted-foreground">
        <Spinner /> Loading invoice…
      </div>
    );
  }

  if (!invoice) {
    return (
      <Alert tone="danger" title="Invoice not found">
        No invoice with id {invoiceId.toString()} exists in this escrow.
      </Alert>
    );
  }

  // Only the named buyer can fund. Checked here for clarity; the contract enforces it.
  if (!address || address.toLowerCase() !== invoice.buyer.toLowerCase()) {
    return (
      <Alert tone="warning" title="You are not the buyer on this invoice">
        <p>
          This invoice can only be funded by <AddressLink address={invoice.buyer} full />.
        </p>
      </Alert>
    );
  }

  if (!isPending) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Nothing to pay</CardTitle>
            <StatusBadge status={invoice.status} />
          </div>
          <CardDescription>
            This invoice is no longer pending, so it cannot be funded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/invoices/${invoiceId}`}>
            <Button variant="outline">View invoice</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > Number(invoice.dueAt)) {
    return (
      <Alert tone="danger" title="This invoice has expired">
        The due date ({formatTimestamp(invoice.dueAt)}) has passed, so the contract will no longer
        accept funding.
      </Alert>
    );
  }

  const required = quote.data?.requiredFxrp;
  const maxAmount = required !== undefined ? applySlippage(required, slippageBps) : undefined;
  const currentAllowance = (allowance.data as bigint | undefined) ?? 0n;
  const currentBalance = (balance.data as bigint | undefined) ?? 0n;

  const needsApproval = maxAmount !== undefined && currentAllowance < maxAmount;
  const insufficientBalance = maxAmount !== undefined && currentBalance < maxAmount;
  const priceAge = quote.data ? now - Number(quote.data.priceTimestamp) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <CardDescription>
            The escrow reads the price on-chain when you fund; this quote is a simulation of that
            same call.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Amount due</span>
            <span className="text-2xl font-semibold">
              {formatCentsAsCurrency(invoice.usdAmountCents)}
            </span>
          </div>

          {quote.isLoading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Spinner /> Fetching the XRP/USD price from FTSOv2…
            </div>
          ) : quote.isError ? (
            <Alert tone="danger" title="Could not price this invoice">
              <p>
                {quote.error instanceof Error
                  ? quote.error.message.slice(0, 200)
                  : "The FTSOv2 quote simulation failed."}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => quote.refetch()}>
                Retry
              </Button>
            </Alert>
          ) : quote.data && decimals !== undefined ? (
            <dl className="space-y-3 text-sm">
              <QuoteRow
                label={`Required ${symbol}`}
                value={formatTokenAmount(quote.data.requiredFxrp, decimals)}
                emphasis
              />
              <QuoteRow label="XRP/USD" value={`$${formatWeiPrice(quote.data.xrpUsdPriceWei)}`} />
              <QuoteRow
                label="Price observed"
                value={`${formatTimestamp(quote.data.priceTimestamp)}${
                  priceAge !== undefined ? ` · ${formatAge(priceAge)}` : ""
                }`}
              />
              <QuoteRow
                label={`Your ${symbol} balance`}
                value={formatTokenAmount(currentBalance, decimals)}
              />
              <QuoteRow
                label="Current allowance"
                value={formatTokenAmount(currentAllowance, decimals)}
              />
            </dl>
          ) : null}

          <div className="space-y-2">
            <span className="text-sm font-medium">Slippage tolerance</span>
            <div className="flex gap-2">
              {SLIPPAGE_OPTIONS.map((option) => (
                <Button
                  key={option.label}
                  size="sm"
                  variant={slippageBps === option.bps ? "default" : "outline"}
                  onClick={() => setSlippageBps(option.bps)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {maxAmount !== undefined && decimals !== undefined ? (
              <p className="text-xs text-muted-foreground">
                You will authorise at most{" "}
                <span className="font-medium text-foreground">
                  {formatTokenAmount(maxAmount, decimals)} {symbol}
                </span>
                . If the price moves beyond this the transaction reverts rather than overpaying.
              </p>
            ) : null}
          </div>

          {insufficientBalance ? (
            <Alert tone="warning" title={`Not enough ${symbol}`}>
              You need at least {decimals !== undefined ? formatTokenAmount(maxAmount!, decimals) : "—"}{" "}
              {symbol}. Get testnet FXRP from the{" "}
              <a
                href="https://faucet.flare.network"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Coston2 faucet
              </a>
              .
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-3 border-t border-border pt-4">
            <Button
              disabled={!needsApproval || approve.isPending || maxAmount === undefined}
              onClick={() => maxAmount !== undefined && approve.mutate(maxAmount)}
            >
              {approve.isPending ? <Spinner /> : null}
              {needsApproval ? `Approve ${symbol}` : `${symbol} approved`}
            </Button>

            <Button
              variant={needsApproval ? "outline" : "default"}
              disabled={
                needsApproval ||
                insufficientBalance ||
                actions.isPending ||
                maxAmount === undefined
              }
              onClick={() => maxAmount !== undefined && actions.fund(maxAmount)}
            >
              {actions.isPending ? <Spinner /> : null}
              Fund escrow
            </Button>
          </div>
        </CardContent>
      </Card>

      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Invoice</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Seller</span>
              <AddressLink address={invoice.seller} />
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Due</span>
              <span>{formatTimestamp(invoice.dueAt)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Privacy</span>
              <Badge variant={invoice.confidential ? "success" : "warning"}>
                {invoice.confidential ? "Confidential" : "Public fallback"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Alert tone="info" title="How funding settles">
          <p className="text-muted-foreground">
            Funding transfers exactly the amount the contract computes from the live feed. Your FXRP
            is held by the escrow until you release it to the seller, the seller refunds you, or the
            grace period lets you reclaim it.
          </p>
        </Alert>
      </aside>
    </div>
  );
}

function QuoteRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasis ? "text-base font-semibold" : ""}>{value}</dd>
    </div>
  );
}
