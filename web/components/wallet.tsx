"use client";

/**
 * Wallet connection, network status, and the network guard.
 *
 * The wrong-network banner is persistent and every transaction button in the app is disabled until
 * the wallet is on BOT Chain — a write sent to the wrong chain would either revert or, worse, hit a
 * different contract at the same address.
 */

import Image from "next/image";
import Link from "next/link";
import { FilePlus2, LayoutDashboard } from "lucide-react";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { botchain } from "@/lib/chain";
import { addressUrl, shortenHex } from "@/lib/explorer";
import { Alert, Badge, Button } from "@/components/ui/primitives";

export function useOnCorrectNetwork(): boolean {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  return isConnected && chainId === botchain.id;
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const injectedConnector = connectors.find((c) => c.type === "injected") ?? connectors[0];

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={addressUrl(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2 font-mono text-xs text-foreground/70 transition-colors hover:border-primary/30 hover:bg-white/[0.07] hover:text-foreground"
        >
          {shortenHex(address)}
        </a>
        <Button variant="ghost" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (!injectedConnector) {
    return (
      <Button size="sm" disabled title="No injected wallet detected">
        No wallet found
      </Button>
    );
  }

  return (
    <Button size="sm" disabled={isPending} onClick={() => connect({ connector: injectedConnector })}>
      {isPending ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}

/**
 * viem's chain name for 677 is plain "BOT Chain", which reads as ambiguous next to a testnet
 * build. Say "Mainnet" outright: whether this is a real deployment is the first thing anyone
 * looking at the app wants to know.
 */
const NETWORK_LABEL = botchain.testnet ? botchain.name : `${botchain.name} Mainnet`;

export function NetworkBadge() {
  const chainId = useChainId();
  const { isConnected } = useAccount();

  if (!isConnected) return <Badge variant="neutral">Not connected</Badge>;
  if (chainId === botchain.id) return <Badge variant="success">{NETWORK_LABEL}</Badge>;
  return <Badge variant="danger">Chain {chainId}</Badge>;
}

/**
 * Persistent banner shown whenever the wallet is connected to the wrong chain.
 * Renders nothing when disconnected — that state is handled per page.
 */
export function WrongNetworkBanner() {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === botchain.id) return null;

  return (
    <div className="border-b border-destructive/30 bg-destructive/10 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <p className="text-sm text-red-200">
          Wrong network: your wallet is on chain {chainId}. This app runs on {botchain.name}
          (chain {botchain.id}). All actions are disabled.
        </p>
        <Button
          size="sm"
          variant="destructive"
          disabled={isPending}
          onClick={() => switchChain({ chainId: botchain.id })}
        >
          {isPending ? "Switching…" : `Switch to ${botchain.name}`}
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps page content that requires a connected wallet on BOT Chain, rendering an explanatory
 * placeholder otherwise.
 */
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  if (!isConnected) {
    return (
      <Alert tone="info" title="Wallet not connected">
        <p className="mb-3">Connect an EVM wallet on {botchain.name} to continue.</p>
        <ConnectButton />
      </Alert>
    );
  }

  if (chainId !== botchain.id) {
    return (
      <Alert tone="warning" title="Wrong network">
        Switch your wallet to {botchain.name} (chain {botchain.id}) to continue.
      </Alert>
    );
  }

  return <>{children}</>;
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/75 backdrop-blur-2xl">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-7">
          <Link
            href="/"
            aria-label="BotSeal home"
            className="relative h-9 w-[8.75rem] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#fafaf8] shadow-[0_10px_35px_hsl(var(--primary)/0.12)] transition-transform hover:scale-[1.02]"
          >
            <Image
              src="/logo.svg"
              alt="BotSeal"
              fill
              sizes="140px"
              className="object-contain object-center p-1.5"
              priority
            />
          </Link>
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-1 text-sm text-foreground/60 md:flex"
          >
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.05] hover:text-foreground"
            >
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
              Dashboard
            </Link>
            <Link
              href="/invoices/new"
              className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.05] hover:text-foreground"
            >
              <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
              Create
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <NetworkBadge />
          </div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
