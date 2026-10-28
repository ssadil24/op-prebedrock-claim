#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isAddress } from "viem";
import { DEFAULT_RPC } from "./constants.mjs";
import { UserError, assertKnownPortal, makeClients } from "./chain.mjs";
import { runCheck, runFinalize, runProve } from "./commands.mjs";
import * as ui from "./ui.mjs";

const USAGE = `
Claim a stuck pre-Bedrock OP Mainnet withdrawal on Ethereum.
This tool NEVER asks for a private key or seed phrase. It only prepares and dry-runs
transactions; you send them yourself from your own wallet.

Usage:
  npm run check    -- --tx <OP tx hash> [--sender <wallet>]
  npm run prove    -- --tx <OP tx hash> --sender <wallet>
  npm run finalize -- --tx <OP tx hash> --sender <wallet>

Options:
  --tx <hash>        The hash of your ORIGINAL withdrawal transaction on OP Mainnet
  --sender <address> The wallet that will pay the Ethereum gas fee and send the prove +
                     finalize transactions (use the SAME wallet for both steps)
  --index <n>        Only if one transaction contains several withdrawals
  --l1-rpc <url>     Ethereum RPC endpoint (default: ${DEFAULT_RPC.l1})
  --l2-rpc <url>     OP Mainnet RPC endpoint (default: ${DEFAULT_RPC.l2})
  --force            Prove again even though a proof already exists
  -h, --help         Show this help

Environment variables TX, SENDER, L1_RPC_URL and L2_RPC_URL work too.
`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      tx: { type: "string" },
      sender: { type: "string" },
      index: { type: "string" },
      "l1-rpc": { type: "string" },
      "l2-rpc": { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  if (!["check", "prove", "finalize"].includes(command)) {
    throw new UserError(`Unknown command "${command}". Use check, prove or finalize (see --help).`);
  }

  const txHash = values.tx ?? process.env.TX;
  const sender = values.sender ?? process.env.SENDER;
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new UserError("Please pass your original OP Mainnet withdrawal transaction hash with --tx 0x… (66 characters).");
  }
  if (sender !== undefined && !isAddress(sender)) {
    throw new UserError("--sender must be a valid Ethereum address (0x… 42 characters).");
  }
  if (command !== "check" && !sender) {
    throw new UserError("Please pass the wallet that will send the Ethereum transactions with --sender 0x…");
  }
  let index;
  if (values.index !== undefined) {
    index = Number(values.index);
    if (!Number.isInteger(index) || index < 0) throw new UserError("--index must be 0, 1, 2, …");
  }

  assertKnownPortal();
  const { l1, l2 } = makeClients({
    l1Rpc: values["l1-rpc"] ?? process.env.L1_RPC_URL ?? DEFAULT_RPC.l1,
    l2Rpc: values["l2-rpc"] ?? process.env.L2_RPC_URL ?? DEFAULT_RPC.l2,
  });
  const ctx = { l1, l2, txHash, sender, index, force: values.force };

  if (command === "check") await runCheck(ctx);
  if (command === "prove") await runProve(ctx);
  if (command === "finalize") await runFinalize(ctx);
}

main().catch((e) => {
  if (e instanceof UserError) {
    ui.bad(e.message);
  } else if (/HttpRequestError|TimeoutError|fetch failed/i.test(`${e?.name} ${e?.message}`)) {
    ui.bad(`Network problem: ${e.shortMessage ?? e.message}`);
    ui.line("Try again, or use another endpoint with --l1-rpc / --l2-rpc (free Alchemy or Infura URLs work).");
  } else {
    ui.bad(`Unexpected error: ${e?.shortMessage ?? e?.message ?? e}`);
  }
  process.exit(1);
});
