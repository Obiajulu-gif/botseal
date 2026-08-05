#!/usr/bin/env python3
"""Regenerate the conformance fixtures in this directory.

The fixtures are committed; this script exists so the hex encodings are derived
rather than hand-written, and so adding a case is a code edit rather than a
manual hex-assembly exercise.

    python3 testdata/conformance/gen_fixtures.py

No third-party dependencies. (The scaffold's original Hello World fixtures
needed `eth_abi` for an ABI-encoded SAY_GOODBYE payload; FlareSeal's INVOICE
request body is raw ECIES ciphertext, so plain stdlib is enough.)

--- What can and cannot be asserted offline ---

`INVOICE/CREATE` decrypts through tee-node's sign port before it can validate
anything. The conformance harness starts the extension process ALONE — no
tee-node, no proxy, no chain — so decryption always fails here. That makes a
success case impossible offline, and it is deliberately not faked: a fixture
asserting status 1 would have to stub the decryptor, at which point it would no
longer be testing the wire contract.

What IS deterministic offline, and is covered below:

  * the three pre-decryption rejection paths (empty payload, invalid hex, and
    the decryption failure itself), all of which must surface as HTTP 200 with
    ActionResult.status 0 — never an HTTP error;
  * the rejection counter accumulating in reported state;
  * every framework-level status code (501/400/405/404);
  * the exact ActionResult field set, including `data: "0x"` and
    `additionalResultStatus: "0x"` being present rather than omitted.

Handler success is covered instead by the vitest suite in
typescript/src/__tests__/, which injects a decryptor through `setDecryptor`.

Fixtures are ORDER-DEPENDENT and share one process: index.json fixes the order
and the final fixture asserts the accumulated state.
"""

from __future__ import annotations

import json
import pathlib

HERE = pathlib.Path(__file__).parent

ACTION_ID = "0x" + "11" * 32
TEE_ID = "0x" + "22" * 20
VERSION = "0.1.0"

OP_TYPE = "INVOICE"
OP_COMMAND = "CREATE"


def b32(s: str) -> str:
    b = s.encode("utf-8")
    return "0x" + b.ljust(32, b"\x00").hex()


def to_hex(b: bytes) -> str:
    return "0x" + b.hex()


def action(
    op_type: str,
    op_command: str,
    original: str,
    action_id: str = ACTION_ID,
) -> dict:
    """Build a POST /action body in the exact shape tee-node sends.

    `original` is passed through as a hex STRING rather than bytes, because
    several cases below deliberately supply a malformed one.
    """
    data_fixed = {
        "instructionId": action_id,
        "teeId": TEE_ID,
        "timestamp": 1700000000,
        "rewardEpochId": 42,
        "opType": b32(op_type),
        "opCommand": b32(op_command),
        "cosigners": [],
        "cosignersThreshold": 0,
        "originalMessage": original,
        "additionalFixedMessage": "0x",
    }
    return {
        "data": {
            "id": action_id,
            "type": "instruction",
            "submissionTag": "submit",
            "message": to_hex(json.dumps(data_fixed).encode("utf-8")),
        },
        "additionalVariableMessages": [],
        "timestamps": [],
        "additionalActionData": "0x",
        "signatures": [],
    }


# A plausible ECIES ciphertext: 0x04-prefixed ephemeral point, IV, body, MAC.
# Its bytes are irrelevant — nothing offline can decrypt it — but it must be
# valid hex and non-empty so the request reaches the decryption step.
CIPHERTEXT = "0x04" + "ab" * 112

# Every rejection below leaves the ActionResult shape identical apart from the
# log line, so the shared expectations live here.
REJECTED = {
    "id": ACTION_ID,
    "submissionTag": "submit",
    "status": 0,
    "opType": b32(OP_TYPE),
    "opCommand": b32(OP_COMMAND),
    "additionalResultStatus": "0x",
    "version": VERSION,
    # hexutil.Bytes has no omitempty: a rejected action still emits "0x".
    "data": "0x",
}


FIXTURES: list[dict] = [
    {
        "name": "01-invoice-create-empty-payload",
        "description": "An empty originalMessage is a handler rejection, not an HTTP error",
        "request": {
            "method": "POST",
            "path": "/action",
            "body": action(OP_TYPE, OP_COMMAND, "0x"),
        },
        "expect": {
            "status": 200,
            "json": {**REJECTED, "log": "error: decoding request: empty payload"},
        },
    },
    {
        "name": "02-invoice-create-invalid-hex",
        "description": "A non-hex originalMessage is rejected by the handler, still HTTP 200",
        "request": {
            "method": "POST",
            "path": "/action",
            "body": action(OP_TYPE, OP_COMMAND, "0xZZZZ"),
        },
        "expect": {
            "status": 200,
            "json_subset": {"status": 0, "data": "0x"},
            "log_prefix": "error: decoding request: invalid hex",
        },
    },
    {
        "name": "03-invoice-create-decryption-unavailable",
        "description": (
            "Well-formed ciphertext with no TEE reachable: the handler reports a generic "
            "decryption failure and must not echo the node's error or the ciphertext"
        ),
        "request": {
            "method": "POST",
            "path": "/action",
            "body": action(OP_TYPE, OP_COMMAND, CIPHERTEXT),
        },
        "expect": {
            "status": 200,
            "json": {**REJECTED, "log": "error: decryption failed"},
        },
    },
    {
        "name": "04-invoice-create-rejection-is-idempotent",
        "description": "A second identical request fails identically — no partial state is kept",
        "request": {
            "method": "POST",
            "path": "/action",
            "body": action(OP_TYPE, OP_COMMAND, CIPHERTEXT),
        },
        "expect": {
            "status": 200,
            "json": {**REJECTED, "log": "error: decryption failed"},
        },
    },
    {
        "name": "05-unknown-op-type",
        "description": "An unrouted opType is 501 with a plain-text body",
        "request": {
            "method": "POST",
            "path": "/action",
            "body": action("NOT_A_REAL_TYPE", OP_COMMAND, CIPHERTEXT),
        },
        "expect": {"status": 501, "text_contains": "unsupported op type"},
    },
    {
        "name": "06-unknown-op-command",
        "description": "A known opType with an unrouted opCommand is also 501",
        "request": {
            "method": "POST",
            "path": "/action",
            "body": action(OP_TYPE, "NOT_A_COMMAND", CIPHERTEXT),
        },
        "expect": {"status": 501},
    },
    {
        "name": "07-greeting-op-type-is-gone",
        "description": (
            "The scaffold's GREETING/SAY_HELLO route must no longer resolve — this fixture "
            "is what catches a half-finished customization that left both extensions wired"
        ),
        "request": {
            "method": "POST",
            "path": "/action",
            "body": action("GREETING", "SAY_HELLO", to_hex(b'{"name":"World"}')),
        },
        "expect": {"status": 501, "text_contains": "unsupported op type"},
    },
    {
        "name": "08-invalid-action-json",
        "description": "A body that is not JSON is 400",
        "request": {"method": "POST", "path": "/action", "raw_body": "not json at all"},
        "expect": {"status": 400},
    },
    {
        "name": "09-invalid-hex-in-message",
        "description": "A non-hex data.message is 400 — rejected by the framework, not the handler",
        "request": {
            "method": "POST",
            "path": "/action",
            "body": {
                "data": {
                    "id": ACTION_ID,
                    "type": "instruction",
                    "submissionTag": "submit",
                    "message": "0xZZZZ",
                }
            },
        },
        "expect": {"status": 400},
    },
    {
        "name": "10-message-not-datafixed",
        "description": "A valid-hex message that is not DataFixed JSON is 400",
        "request": {
            "method": "POST",
            "path": "/action",
            "body": {
                "data": {
                    "id": ACTION_ID,
                    "type": "instruction",
                    "submissionTag": "submit",
                    "message": to_hex(b"not json"),
                }
            },
        },
        "expect": {"status": 400},
    },
    {
        "name": "11-get-action-not-allowed",
        "description": "GET /action is 405",
        "request": {"method": "GET", "path": "/action"},
        "expect": {"status": 405},
    },
    {
        "name": "12-post-state-not-allowed",
        "description": "POST /state is 405",
        "request": {"method": "POST", "path": "/state", "raw_body": ""},
        "expect": {"status": 405},
    },
    {
        "name": "13-unknown-path",
        "description": "An unknown path is 404",
        "request": {"method": "GET", "path": "/does-not-exist"},
        "expect": {"status": 404},
    },
    {
        "name": "14-get-state",
        "description": (
            "GET /state returns bytes32 stateVersion and the accumulated counters. "
            "Four actions reached the handler and all four were rejected; the 501s never "
            "did, so they must not be counted."
        ),
        "request": {"method": "GET", "path": "/state"},
        "expect": {
            "status": 200,
            "json": {
                # Asymmetric with ActionResult.version by design — contract §4.5.
                "stateVersion": b32(VERSION),
                "state": {
                    "invoicesProcessed": 0,
                    "invoicesRejected": 4,
                    "lastStatus": "error",
                },
            },
        },
    },
    {
        "name": "15-state-exposes-no-invoice-content",
        "description": (
            "Privacy guard: reported state carries counters only. Any field beyond these "
            "three is a leak of invoice content into a public endpoint."
        ),
        "request": {"method": "GET", "path": "/state"},
        "expect": {
            "status": 200,
            "json": {
                "stateVersion": b32(VERSION),
                "state": {
                    "invoicesProcessed": 0,
                    "invoicesRejected": 4,
                    "lastStatus": "error",
                },
            },
        },
    },
]


def main() -> None:
    index = []
    for f in FIXTURES:
        path = HERE / f"{f['name']}.json"
        path.write_text(json.dumps(f, indent=2) + "\n")
        index.append(f["name"])

    # Remove fixtures from a previous generation that are no longer produced,
    # so a stale Hello World case cannot linger and silently stop being run.
    for existing in sorted(HERE.glob("*.json")):
        if existing.name == "index.json":
            continue
        if existing.stem not in index:
            existing.unlink()
            print(f"removed stale fixture {existing.name}")

    (HERE / "index.json").write_text(json.dumps({"fixtures": index}, indent=2) + "\n")
    print(f"wrote {len(index)} fixtures + index.json to {HERE}")


if __name__ == "__main__":
    main()
