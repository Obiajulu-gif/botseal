"use client";

/**
 * Wallet connection, network status, and the network guard.
 *
 * The wrong-network banner is persistent and every transaction button in the app is disabled until
 * the wallet is on Coston2 — a write sent to the wrong chain would either revert or, worse, hit a
 * different contract at the same address.
 */

import Link from "next/link";
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { coston2 } from "@/lib/flare";
import { addressUrl, shortenHex } from "@/lib/explorer";
import { Alert, Badge, Button } from "@/components/ui/primitives";

export function useOnCorrectNetwork(): boolean {
  const chainId = useChainId();
  const { isConnected } = useAccount();
  return isConnected && chainId === coston2.id;
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
          className="rounded-md border border-border px-3 py-1.5 font-mono text-xs hover:bg-muted"
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

export function NetworkBadge() {
  const chainId = useChainId();
  const { isConnected } = useAccount();

  if (!isConnected) return <Badge variant="neutral">Not connected</Badge>;
  if (chainId === coston2.id) return <Badge variant="success">Coston2</Badge>;
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

  if (!isConnected || chainId === coston2.id) return null;

  return (
    <div className="border-b border-destructive/40 bg-destructive/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm text-destructive">
          Wrong network: your wallet is on chain {chainId}. FlareSeal runs on Flare Testnet Coston2
          (chain {coston2.id}). All actions are disabled.
        </p>
        <Button
          size="sm"
          variant="destructive"
          disabled={isPending}
          onClick={() => switchChain({ chainId: coston2.id })}
        >
          {isPending ? "Switching…" : "Switch to Coston2"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Wraps page content that requires a connected wallet on Coston2, rendering an explanatory
 * placeholder otherwise.
 */
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();

  if (!isConnected) {
    return (
      <Alert tone="info" title="Wallet not connected">
        <p className="mb-3">Connect an EVM wallet on Coston2 to continue.</p>
        <ConnectButton />
      </Alert>
    );
  }

  if (chainId !== coston2.id) {
    return (
      <Alert tone="warning" title="Wrong network">
        Switch your wallet to Flare Testnet Coston2 (chain {coston2.id}) to continue.
      </Alert>
    );
  }

  return <>{children}</>;
}

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-base font-semibold tracking-tight">
            Flare<span className="text-primary">Seal</span>
          </Link>
          <nav className="hidden gap-4 text-sm text-muted-foreground sm:flex">
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/invoices/new" className="hover:text-foreground">
              New invoice
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <NetworkBadge />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
