"use client";

import Link from "next/link";
import {
  ArrowRight,
  Binary,
  CheckCircle2,
  CircleDollarSign,
  Cpu,
  FileLock2,
  Fingerprint,
  LockKeyhole,
  Orbit,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useAccount } from "wagmi";

import { AddressLink } from "@/components/common";
import { ConnectButton } from "@/components/wallet";
import {
  Alert,
  Badge,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { useConfidentialAvailable } from "@/hooks/use-invoices";
import { env, isEscrowConfigured, isInstructionSenderConfigured } from "@/lib/env";
import { coston2 } from "@/lib/flare";
import { cn } from "@/lib/utils";

const FAUCET_URL = "https://faucet.flare.network";

const PROTOCOL_STEPS: Array<{
  icon: LucideIcon;
  index: string;
  title: string;
  label: string;
  description: string;
}> = [
  {
    icon: FileLock2,
    index: "01",
    title: "Protect",
    label: "Browser encrypted",
    description:
      "Line items, identities, tax details, and fresh entropy are encrypted before they leave the seller’s device.",
  },
  {
    icon: Cpu,
    index: "02",
    title: "Prove",
    label: "TEE verified",
    description:
      "Flare Confidential Compute decrypts and validates inside an enclave, then signs only the settlement facts.",
  },
  {
    icon: CircleDollarSign,
    index: "03",
    title: "Settle",
    label: "FXRP escrowed",
    description:
      "The buyer funds at the live FTSOv2 rate while the contract enforces release, refund, and expiry rules.",
  },
];

const PUBLIC_FIELDS = ["Seller + buyer", "USD total", "Due date", "32-byte commitment"];
const PRIVATE_FIELDS = ["Line items", "Customer identity", "Tax details", "Nonce + salt"];

export default function HomePage() {
  const { isConnected } = useAccount();
  const confidential = useConfidentialAvailable();

  return (
    <div className="space-y-24 pb-8 sm:space-y-32">
      <section className="relative grid items-center gap-12 pt-4 lg:min-h-[calc(100vh-9rem)] lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div className="relative z-10 max-w-3xl">
          <div className="mb-7 flex flex-wrap items-center gap-3">
            <Badge variant="default" className="border-primary/25 bg-primary/[0.08]">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Confidential commerce protocol
            </Badge>
            <Badge variant="neutral">
              <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_hsl(var(--accent))]" />
              Coston2 · chain {coston2.id}
            </Badge>
          </div>

          <p className="eyebrow mb-5">Built for private on-chain business</p>
          <h1 className="font-display text-5xl font-semibold leading-[0.96] tracking-[-0.06em] text-foreground sm:text-[3.5rem] lg:text-[3.5rem] xl:text-[4.25rem]">
            Confidential invoices,
            <span className="text-gradient block">sealed for settlement.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-7 text-foreground/[0.67] sm:text-lg sm:leading-8">
            Keep commercial terms unreadable. Prove the total inside trusted compute. Settle in FXRP
            with only the minimum facts exposed on-chain.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            {isConnected ? (
              <Link
                href="/invoices/new"
                className={cn(buttonVariants({ size: "lg" }), "min-w-44")}
              >
                Seal an invoice
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            ) : (
              <ConnectButton />
            )}
            <Link href="/dashboard" className={buttonVariants({ size: "lg", variant: "outline" })}>
              Explore dashboard
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-foreground/60">
            <TrustPoint>Client-side encryption</TrustPoint>
            <TrustPoint>TEE-signed results</TrustPoint>
            <TrustPoint>Live FTSOv2 pricing</TrustPoint>
          </div>
        </div>

        <SealedInvoiceVisual />
      </section>

      {!isEscrowConfigured ? (
        <Alert tone="warning" title="Demo contracts are not configured">
          <p>
            The interface is ready, but on-chain actions stay disabled until the Coston2 escrow is
            configured in <code className="font-mono text-xs">web/.env.local</code>.
          </p>
        </Alert>
      ) : null}

      <section className="content-auto grid gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-2 lg:grid-cols-4">
        <SignalStat icon={LockKeyhole} value="Local-first" label="Plaintext boundary" />
        <SignalStat icon={Fingerprint} value="32 bytes" label="Terms commitment" />
        <SignalStat icon={Cpu} value="TEE signed" label="Validation result" />
        <SignalStat icon={Orbit} value="On-chain" label="Escrow enforcement" />
      </section>

      <section id="protocol" className="content-auto scroll-mt-28">
        <div className="mb-10 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="eyebrow mb-4">The protocol in three moves</p>
            <h2 className="font-display text-3xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Private by design. Verifiable by anyone.
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-foreground/60">
            Familiar invoice and escrow mental models, rebuilt with a strict privacy boundary at
            every handoff.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {PROTOCOL_STEPS.map((step) => (
            <ProtocolCard key={step.title} {...step} />
          ))}
        </div>
      </section>

      <section className="content-auto grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <Card className="interactive-lift min-h-[30rem] border-primary/15 p-2">
          <CardHeader className="p-6 sm:p-8">
            <p className="eyebrow mb-3">The privacy boundary</p>
            <CardTitle className="text-3xl sm:text-4xl">Reveal the proof, not the business.</CardTitle>
            <CardDescription className="max-w-xl text-base">
              FlareSeal splits every invoice into two deliberate data zones. Sensitive commercial
              context stays encrypted; settlement-critical facts remain independently auditable.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 p-6 pt-1 sm:grid-cols-2 sm:p-8 sm:pt-1">
            <DataZone
              icon={FileLock2}
              title="Sealed payload"
              label="Encrypted in browser"
              items={PRIVATE_FIELDS}
              accent="private"
            />
            <DataZone
              icon={ShieldCheck}
              title="Settlement proof"
              label="Minimal on-chain record"
              items={PUBLIC_FIELDS}
              accent="public"
            />
          </CardContent>
        </Card>

        <Card className="interactive-lift border-accent/10">
          <CardHeader className="p-7 sm:p-8">
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="eyebrow">Live protocol proof</p>
              {confidential.isLoading ? (
                <Badge variant="neutral">Checking</Badge>
              ) : confidential.available ? (
                <Badge variant="success">TEE available</Badge>
              ) : (
                <Badge variant="warning">Setup pending</Badge>
              )}
            </div>
            <CardTitle className="text-2xl">This build points to real Flare infrastructure.</CardTitle>
            <CardDescription>
              No decorative dashboard metrics—these are the contracts and services behind the demo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 p-7 pt-0 sm:p-8 sm:pt-0">
            <DeploymentRow label="Escrow" address={env.escrowAddress} />
            <DeploymentRow label="Instruction sender" address={env.instructionSenderAddress} />
            <DeploymentRow label="FXRP" address={env.fxrpAddress} />
            <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/20 p-4 text-xs leading-5 text-foreground/60">
              {isInstructionSenderConfigured
                ? "Confidential instructions route through the configured FCC sender."
                : "Deploy the FCC instruction sender to activate the full private flow."}
            </div>
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-4")}
            >
              Open Coston2 faucet
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </CardContent>
        </Card>
      </section>

      <section className="content-auto relative overflow-hidden rounded-[1.75rem] border border-primary/20 bg-primary/[0.07] px-6 py-12 sm:px-12 sm:py-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,hsl(var(--primary)/0.22),transparent_28rem)]" />
        <div className="relative z-10 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">Ready to test the privacy boundary?</p>
            <h2 className="font-display text-3xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Turn an invoice into a verifiable secret.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-foreground/[0.67] sm:text-base">
              Create the private payload, watch the TEE lifecycle, and inspect exactly what reaches
              Coston2.
            </p>
          </div>
          <Link
            href="/invoices/new"
            className={cn(buttonVariants({ size: "lg" }), "shrink-0")}
          >
            Launch the demo
            <Zap className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function SealedInvoiceVisual() {
  return (
    <div
      className="seal-stage group lg:rotate-[1.5deg] lg:transition-transform lg:duration-500 lg:hover:rotate-0"
      role="img"
      aria-label="Animated encrypted invoice entering a trusted compute seal and producing a minimal settlement proof"
    >
      <div className="seal-orbit" aria-hidden="true" />
      <div className="seal-orbit seal-orbit-secondary" aria-hidden="true" />

      <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/30 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-foreground/60 backdrop-blur-md">
        <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_hsl(var(--accent))]" />
        Privacy engine online
      </div>

      <div className="float-delayed absolute right-5 top-20 rounded-xl border border-accent/20 bg-accent/[0.08] px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-accent backdrop-blur-md">
        TEE · attested
      </div>

      <div className="float-slow absolute left-4 top-32 rounded-xl border border-primary/20 bg-primary/[0.08] px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[#ff9a7d] backdrop-blur-md sm:left-8">
        AES payload · sealed
      </div>

      <div className="absolute left-1/2 top-1/2 w-[17.5rem] -translate-x-1/2 -translate-y-1/2 sm:w-[19rem]">
        <div className="float-slow relative overflow-hidden rounded-[1.45rem] border border-white/10 bg-[#10131c]/95 p-5 shadow-[0_30px_90px_hsl(228_90%_2%/0.8)] backdrop-blur-xl transition-transform duration-500 group-hover:scale-[1.025]">
          <div className="invoice-scan" aria-hidden="true" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                <FileLock2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-display text-sm font-semibold">INVOICE // 014</p>
                <p className="mt-1 text-[0.62rem] uppercase tracking-[0.12em] text-foreground/40">
                  Client encrypted
                </p>
              </div>
            </div>
            <Binary className="h-5 w-5 text-accent/60" aria-hidden="true" />
          </div>

          <div className="mt-6 space-y-3">
            <EncryptedLine width="w-full" />
            <EncryptedLine width="w-4/5" />
            <EncryptedLine width="w-2/3" />
          </div>

          <div className="mt-6 flex items-end justify-between border-t border-white/[0.07] pt-4">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.14em] text-foreground/40">Private total</p>
              <p className="mt-1 font-mono text-sm text-foreground/80">•••••• USD</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-[0_0_35px_hsl(var(--primary)/0.38)]">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>

      <div className="float-delayed absolute bottom-5 right-5 max-w-[13rem] rounded-2xl border border-white/[0.09] bg-black/35 p-3 backdrop-blur-xl sm:bottom-8 sm:right-8">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-accent" aria-hidden="true" />
          <span className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-foreground/80">
            Minimal proof emitted
          </span>
        </div>
        <p className="mt-2 font-mono text-[0.62rem] leading-4 text-foreground/40">
          0x7fb2…c91e · total · parties · due
        </p>
      </div>
    </div>
  );
}

function EncryptedLine({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
      <span className={`h-2 rounded-full bg-gradient-to-r from-white/15 to-white/[0.035] ${width}`} />
    </div>
  );
}

function TrustPoint({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      {children}
    </span>
  );
}

function SignalStat({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="flex items-center gap-4 bg-background/90 px-5 py-5 sm:px-6">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div>
        <p className="font-display text-sm font-semibold text-foreground/90">{value}</p>
        <p className="mt-1 text-xs text-foreground/40">{label}</p>
      </div>
    </div>
  );
}

function ProtocolCard({
  icon: Icon,
  index,
  title,
  label,
  description,
}: (typeof PROTOCOL_STEPS)[number]) {
  return (
    <Card className="interactive-lift group min-h-[20rem]">
      <CardHeader className="p-7">
        <div className="mb-10 flex items-center justify-between">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/[0.08] text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-mono text-xs text-foreground/30">{index}</span>
        </div>
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-accent">{label}</p>
        <CardTitle className="text-3xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-7 pb-7 text-sm leading-6 text-foreground/60">
        {description}
      </CardContent>
    </Card>
  );
}

function DataZone({
  icon: Icon,
  title,
  label,
  items,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  label: string;
  items: string[];
  accent: "private" | "public";
}) {
  const isPrivate = accent === "private";

  return (
    <div
      className={`rounded-2xl border p-5 ${
        isPrivate ? "border-primary/20 bg-primary/[0.055]" : "border-accent/20 bg-accent/[0.045]"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            isPrivate ? "bg-primary/[0.12] text-primary" : "bg-accent/10 text-accent"
          }`}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-display text-sm font-semibold">{title}</p>
          <p className="mt-1 text-[0.65rem] uppercase tracking-[0.12em] text-foreground/40">{label}</p>
        </div>
      </div>
      <ul className="mt-5 space-y-3 text-sm text-foreground/60">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2.5">
            <span className={`h-1 w-1 rounded-full ${isPrivate ? "bg-primary" : "bg-accent"}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeploymentRow({ label, address }: { label: string; address?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] py-3.5 last:border-0">
      <dt className="text-sm text-foreground/60">{label}</dt>
      <dd>
        {address ? (
          <AddressLink address={address} />
        ) : (
          <span className="text-xs text-foreground/30">Not deployed</span>
        )}
      </dd>
    </div>
  );
}
