"use client";

/**
 * The confidential invoice creation state machine.
 *
 *   idle → loading-extension-info → encrypting → awaiting-wallet-signature
 *        → submitting-instruction → waiting-for-result → relaying-result → confirmed
 *
 * Privacy rules enforced here:
 *   - The plaintext payload exists only as a local `const` inside {@link create}. It is never put in
 *     React state, localStorage, a URL, a toast, or a log line.
 *   - The nonce and salt are generated per invoice and dropped with the payload.
 *   - Errors surfaced to the UI describe the step that failed, never the invoice content.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { decodeEventLog, type Hex, type TransactionReceipt } from "viem";
import { useConfig } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { env, instructionFeeWei } from "@/lib/env";
import { escrowAbi, instructionSenderAbi, instructionSenderAddress } from "@/lib/contracts";
import { explainError } from "@/lib/errors";
import {
  encryptToTee,
  normaliseFccResponse,
  type ExtensionInfo,
  type FccResult,
} from "@/lib/fcc";
import type { PrivateInvoicePayload } from "@/lib/invoice";

export type ConfidentialPhase =
  | "idle"
  | "loading-extension-info"
  | "encrypting"
  | "awaiting-wallet-signature"
  | "submitting-instruction"
  | "waiting-for-result"
  | "relaying-result"
  | "confirmed";

export type ConfidentialErrorKind =
  | "extension-unavailable"
  | "wallet-rejected"
  | "instruction-failed"
  | "result-timeout"
  | "tee-reported-error"
  | "relay-reverted"
  | "wrong-network";

export interface ConfidentialError {
  kind: ConfidentialErrorKind;
  message: string;
}

export interface ConfidentialState {
  phase: ConfidentialPhase;
  error?: ConfidentialError;
  /** Populated as the flow progresses, for the transaction receipts panel. */
  instructionTxHash?: Hex;
  actionId?: Hex;
  relayTxHash?: Hex;
  invoiceId?: bigint;
  /** Seconds spent waiting on the TEE, for the progress display. */
  waitedSeconds: number;
}

const INITIAL: ConfidentialState = { phase: "idle", waitedSeconds: 0 };

/** Human-readable label per phase, used by the progress UI. */
export const PHASE_LABELS: Record<ConfidentialPhase, string> = {
  idle: "Ready",
  "loading-extension-info": "Fetching the extension's public key…",
  encrypting: "Encrypting the invoice in your browser…",
  "awaiting-wallet-signature": "Waiting for you to confirm in your wallet…",
  "submitting-instruction": "Submitting the encrypted instruction on-chain…",
  "waiting-for-result": "Waiting for the TEE to validate and sign…",
  "relaying-result": "Relaying the signed result into the escrow…",
  confirmed: "Confidential invoice created.",
};

async function fetchExtensionInfo(signal: AbortSignal): Promise<ExtensionInfo> {
  const response = await fetch("/api/fcc/info", { signal, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "The confidential extension is unavailable.");
  }
  return (await response.json()) as ExtensionInfo;
}

export function useConfidentialInvoice() {
  const config = useConfig();
  const [state, setState] = useState<ConfidentialState>(INITIAL);
  const abortRef = useRef<AbortController | undefined>(undefined);

  // Stop polling if the component unmounts mid-flight.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL);
  }, []);

  /**
   * Polls `/api/fcc/result/<actionId>` until the TEE returns a terminal status or the configured
   * timeout elapses. Stops immediately on success or a TEE-reported error.
   */
  const pollForResult = useCallback(
    async (actionId: Hex, signal: AbortSignal): Promise<FccResult> => {
      const deadline = Date.now() + env.fccResultTimeoutMs;
      const startedAt = Date.now();

      for (;;) {
        if (signal.aborted) throw new DOMException("aborted", "AbortError");

        const response = await fetch(`/api/fcc/result/${actionId}`, { signal, cache: "no-store" });

        // 202 is this app's "not processed yet"; other non-OK codes are transient proxy problems.
        if (response.ok) {
          const state = normaliseFccResponse(await response.json());

          if (state.kind === "success") return state.result;
          if (state.kind === "error") {
            const error: ConfidentialError = { kind: "tee-reported-error", message: state.message };
            throw Object.assign(new Error(state.message), { confidential: error });
          }
        }

        if (Date.now() >= deadline) {
          const message = `The TEE did not return a result within ${Math.round(
            env.fccResultTimeoutMs / 1000,
          )}s.`;
          throw Object.assign(new Error(message), {
            confidential: { kind: "result-timeout", message } satisfies ConfidentialError,
          });
        }

        setState((prev) => ({
          ...prev,
          waitedSeconds: Math.floor((Date.now() - startedAt) / 1000),
        }));

        await new Promise((resolve) => setTimeout(resolve, env.fccPollIntervalMs));
      }
    },
    [],
  );

  /**
   * Runs the full flow. `payload` is consumed immediately and never retained.
   *
   * @returns the new invoice id on success, or `undefined` if the flow failed.
   */
  const create = useCallback(
    async (payload: PrivateInvoicePayload): Promise<bigint | undefined> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const fail = (kind: ConfidentialErrorKind, message: string) => {
        setState((prev) => ({ ...prev, error: { kind, message } }));
        return undefined;
      };

      try {
        // --- 1. Extension public key -----------------------------------------
        setState({ phase: "loading-extension-info", waitedSeconds: 0 });
        let info: ExtensionInfo;
        try {
          info = await fetchExtensionInfo(controller.signal);
        } catch (error) {
          return fail(
            "extension-unavailable",
            error instanceof Error ? error.message : "The confidential extension is unavailable.",
          );
        }

        // --- 2. Encrypt in the browser ---------------------------------------
        setState((prev) => ({ ...prev, phase: "encrypting" }));
        let ciphertext: Hex;
        try {
          // The only place the plaintext is serialised. Both the JSON string and `payload` go out
          // of scope when this function returns.
          ciphertext = await encryptToTee(info.publicKey, JSON.stringify(payload));
        } catch {
          return fail("extension-unavailable", "Could not encrypt the invoice to the TEE key.");
        }

        // --- 3. Submit the instruction ---------------------------------------
        setState((prev) => ({ ...prev, phase: "awaiting-wallet-signature" }));
        let instructionReceipt: TransactionReceipt;
        try {
          const hash = await writeContract(config, {
            abi: instructionSenderAbi,
            address: instructionSenderAddress(),
            functionName: "sendCreateInvoice",
            args: [ciphertext],
            value: instructionFeeWei(),
          });

          setState((prev) => ({ ...prev, phase: "submitting-instruction", instructionTxHash: hash }));
          instructionReceipt = await waitForTransactionReceipt(config, { hash });
        } catch (error) {
          const message = explainError(error);
          const rejected = /rejected/i.test(message);
          return fail(rejected ? "wallet-rejected" : "instruction-failed", message);
        }

        if (instructionReceipt.status !== "success") {
          return fail("instruction-failed", "The instruction transaction reverted on-chain.");
        }

        // --- 4. Extract the action id ----------------------------------------
        const actionId = extractActionId(instructionReceipt);
        if (!actionId) {
          return fail(
            "instruction-failed",
            "The instruction transaction emitted no ConfidentialInvoiceRequested event.",
          );
        }
        setState((prev) => ({ ...prev, phase: "waiting-for-result", actionId }));

        // --- 5. Poll for the TEE-signed result --------------------------------
        let result: FccResult;
        try {
          result = await pollForResult(actionId, controller.signal);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return undefined;
          const attached = (error as { confidential?: ConfidentialError }).confidential;
          if (attached) return fail(attached.kind, attached.message);
          return fail("result-timeout", "Could not retrieve the TEE result.");
        }

        // --- 6. Relay the exact signed bytes ----------------------------------
        setState((prev) => ({ ...prev, phase: "relaying-result" }));
        let relayReceipt: TransactionReceipt;
        try {
          const hash = await writeContract(config, {
            abi: escrowAbi,
            address: payload.escrowContract,
            functionName: "relayConfidentialInvoice",
            // Verbatim, in the contract's parameter order. Re-encoding any of these would change
            // ActionResult.Hash() and the on-chain signature check would fail.
            args: [
              result.data,
              result.actionId,
              result.submissionTag,
              result.status,
              result.signature,
            ],
          });

          setState((prev) => ({ ...prev, relayTxHash: hash }));
          relayReceipt = await waitForTransactionReceipt(config, { hash });
        } catch (error) {
          const message = explainError(error);
          return fail(/rejected/i.test(message) ? "wallet-rejected" : "relay-reverted", message);
        }

        if (relayReceipt.status !== "success") {
          return fail("relay-reverted", "The relay transaction reverted on-chain.");
        }

        // --- 7. Read the new invoice id from the event -------------------------
        const invoiceId = extractInvoiceId(relayReceipt);
        setState((prev) => ({ ...prev, phase: "confirmed", invoiceId }));
        return invoiceId;
      } finally {
        if (abortRef.current === controller) abortRef.current = undefined;
      }
    },
    [config, pollForResult],
  );

  return { state, create, reset };
}

/** Finds `ConfidentialInvoiceRequested` in the instruction receipt and returns its action id. */
function extractActionId(receipt: TransactionReceipt): Hex | undefined {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: instructionSenderAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "ConfidentialInvoiceRequested") {
        const args = decoded.args as unknown as { actionId: Hex };
        return args.actionId;
      }
    } catch {
      // Logs from the registry and other contracts are expected here; skip anything foreign.
    }
  }
  return undefined;
}

/** Finds `InvoiceCreated` in the relay receipt and returns the new invoice id. */
function extractInvoiceId(receipt: TransactionReceipt): bigint | undefined {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "InvoiceCreated") {
        const args = decoded.args as unknown as { invoiceId: bigint };
        return args.invoiceId;
      }
    } catch {
      // Not an escrow event.
    }
  }
  return undefined;
}
