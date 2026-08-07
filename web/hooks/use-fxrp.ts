"use client";

/**
 * FXRP token reads and the quote simulation.
 *
 * The quote comes from simulating `quoteInvoice` rather than sending it: the function is `payable`
 * (FTSOv2's `getFeedByIdInWei` is), so calling it for real would cost gas to learn a price. The
 * simulation returns the same values the contract would compute in `fundInvoice` moments later.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Hex } from "viem";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useQuery } from "@tanstack/react-query";

import { erc20Abi, escrowAbi, escrowAddress, fxrpAddress } from "@/lib/contracts";
import { env } from "@/lib/env";
import { explainError } from "@/lib/errors";
import { txUrl } from "@/lib/explorer";
import { coston2 } from "@/lib/flare";

const fxrp = () => env.fxrpAddress as Hex | undefined;

export function useFxrpMetadata() {
  const address = fxrp();

  const symbol = useReadContract({
    abi: erc20Abi,
    address,
    functionName: "symbol",
    query: { enabled: Boolean(address), staleTime: Infinity },
  });

  const decimals = useReadContract({
    abi: erc20Abi,
    address,
    functionName: "decimals",
    query: { enabled: Boolean(address), staleTime: Infinity },
  });

  return {
    symbol: symbol.data ?? "FXRP",
    decimals: decimals.data,
    isLoading: symbol.isLoading || decimals.isLoading,
  };
}

export function useFxrpBalance(owner?: Hex) {
  const address = fxrp();
  return useReadContract({
    abi: erc20Abi,
    address,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    query: { enabled: Boolean(address && owner) },
  });
}

export function useFxrpAllowance(owner?: Hex) {
  const address = fxrp();
  return useReadContract({
    abi: erc20Abi,
    address,
    functionName: "allowance",
    args: owner && env.escrowAddress ? [owner, env.escrowAddress as Hex] : undefined,
    query: { enabled: Boolean(address && owner && env.escrowAddress) },
  });
}

export interface InvoiceQuote {
  requiredFxrp: bigint;
  xrpUsdPriceWei: bigint;
  priceTimestamp: bigint;
  /** When the quote was taken, for the staleness display. */
  fetchedAt: number;
}

/**
 * Simulates `quoteInvoice`, refreshing periodically so a displayed price cannot silently age out.
 */
export function useInvoiceQuote(invoiceId?: bigint, enabled = true) {
  const config = useConfig();
  const { address } = useAccount();

  return useQuery<InvoiceQuote>({
    queryKey: ["invoice-quote", invoiceId?.toString(), address],
    enabled: enabled && invoiceId !== undefined && Boolean(env.escrowAddress),
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const { result } = await simulateContract(config, {
        // Quote against Coston2 explicitly, so the price shown can never come from whatever
        // chain the wallet is currently pointed at.
        chainId: coston2.id,
        abi: escrowAbi,
        address: escrowAddress(),
        functionName: "quoteInvoice",
        args: [invoiceId!],
        ...(address ? { account: address } : {}),
      });

      const [requiredFxrp, xrpUsdPriceWei, priceTimestamp] = result as unknown as [
        bigint,
        bigint,
        bigint,
      ];

      return {
        requiredFxrp,
        xrpUsdPriceWei,
        priceTimestamp,
        fetchedAt: Math.floor(Date.now() / 1000),
      };
    },
  });
}

/**
 * Approves FXRP for the escrow.
 *
 * Approves the exact amount the buyer is about to spend — never an unlimited allowance — and
 * re-reads the allowance once the receipt confirms.
 */
export function useApproveFxrp() {
  const config = useConfig();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (amount: bigint) => {
      const hash = await writeContract(config, {
        // See the note in use-invoices.ts: pinning the chain turns a wrong-network send into a
        // clear pre-flight error instead of a failed mainnet transaction.
        chainId: coston2.id,
        abi: erc20Abi,
        address: fxrpAddress(),
        functionName: "approve",
        args: [escrowAddress(), amount],
      });

      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status !== "success") {
        throw new Error("The approval transaction reverted.");
      }
      return receipt;
    },
    onSuccess: (receipt) => {
      toast.success("FXRP approved.", {
        description: "View on Coston2 explorer",
        action: {
          label: "Open",
          onClick: () => window.open(txUrl(receipt.transactionHash), "_blank", "noopener"),
        },
      });
      void queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(explainError(error)),
  });
}

/** Formats a token amount using the token's real decimals. */
export function formatTokenAmount(amount: bigint, decimals: number, precision = 6): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) return whole.toString();

  const padded = fraction.toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return padded.length > 0 ? `${whole}.${padded}` : whole.toString();
}
