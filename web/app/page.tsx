"use client";

import Link from "next/link";
import { useAccount } from "wagmi";

import { AddressLink } from "@/components/common";
import { ConnectButton } from "@/components/wallet";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { env, isEscrowConfigured, isInstructionSenderConfigured } from "@/lib/env";
import { useConfidentialAvailable } from "@/hooks/use-invoices";
import { coston2 } from "@/lib/flare";

const FAUCET_URL = "https://faucet.flare.network";

const FLOW = [
  "Seller fills a private invoice form in the browser.",
  "The browser encrypts it to the TEE's public key — plaintext never leaves the device.",
  "The ciphertext is submitted on-chain through the FCC InstructionSender.",
  "The TEE decrypts it, validates the terms, computes the total, and signs a minimal public result.",
  "The seller relays those exact signed bytes into FlareSealEscrow.",
  "The buyer funds in FXRP at the live FTSOv2 XRP/USD rate, then releases the escrow.",
];

export default function HomePage() {
  const { isConnected } = useAccount();
  const confidential = useConfidentialAvailable();

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <Badge variant="default">Flare Testnet Coston2 · chain {coston2.id}</Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Confidential invoices, settled in FXRP.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          FlareSeal keeps invoice line items, customer identities, and tax details off-chain and
          unreadable. A Flare Confidential Compute TEE validates the invoice inside an enclave and
          signs only what settlement requires: the parties, the total, the due date, and a
          commitment binding the private terms.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {isConnected ? (
            <>
              <Link href="/invoices/new">
                <Button>Create an invoice</Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="outline">Open dashboard</Button>
              </Link>
            </>
          ) : (
            <ConnectButton />
          )}
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost">Coston2 faucet ↗</Button>
          </a>
        </div>
      </section>

      {!isEscrowConfigured ? (
        <Alert tone="warning" title="Contracts not configured">
          <p>
            <code className="font-mono text-xs">NEXT_PUBLIC_ESCROW_ADDRESS</code> is not set, so
            on-chain actions are disabled. Deploy the escrow to Coston2 and set the address in{" "}
            <code className="font-mono text-xs">web/.env.local</code> — see{" "}
            <code className="font-mono text-xs">docs/DEPLOYMENT.md</code>.
          </p>
        </Alert>
      ) : null}

      <section className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>How a confidential invoice works</CardTitle>
            <CardDescription>The path from a form field to a settled escrow.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {FLOW.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deployment status</CardTitle>
            <CardDescription>Addresses this build is pointed at.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <DeploymentRow label="Escrow" address={env.escrowAddress} />
              <DeploymentRow label="InstructionSender" address={env.instructionSenderAddress} />
              <DeploymentRow label="FXRP" address={env.fxrpAddress} />
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Confidential mode</dt>
                <dd>
                  {confidential.isLoading ? (
                    <Badge variant="neutral">Checking…</Badge>
                  ) : confidential.available ? (
                    <Badge variant="success">Available</Badge>
                  ) : isInstructionSenderConfigured ? (
                    <Badge variant="warning">Awaiting TEE</Badge>
                  ) : (
                    <Badge variant="warning">Not configured</Badge>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Public fallback</dt>
                <dd>
                  {env.enablePublicMode ? (
                    <Badge variant="warning">Enabled</Badge>
                  ) : (
                    <Badge variant="neutral">Disabled</Badge>
                  )}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </section>

      <section>
        <Alert tone="info" title="What stays private, and what does not">
          <p className="text-muted-foreground">
            Line items, descriptions, customer details, the nonce and the salt are encrypted in the
            browser and only ever readable inside the TEE. What lands on-chain is the seller, the
            buyer, the USD total, the due date, and a 32-byte commitment. The encrypted payload is
            public and permanent — encryption protects it under today&apos;s assumptions, not
            forever. See <code className="font-mono text-xs">docs/SECURITY.md</code>.
          </p>
        </Alert>
      </section>
    </div>
  );
}

function DeploymentRow({ label, address }: { label: string; address?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {address ? (
          <AddressLink address={address} />
        ) : (
          <span className="text-xs text-muted-foreground">Not deployed</span>
        )}
      </dd>
    </div>
  );
}
