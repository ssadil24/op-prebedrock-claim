import fs from "node:fs";
import path from "node:path";
import { encodeFunctionData, formatEther } from "viem";
import { optimism } from "viem/chains";
import { ADDRESSES, portalAbi } from "./constants.mjs";
import {
  UserError,
  isRegisteredOnL2,
  loadLegacyWithdrawal,
  readL1Status,
} from "./chain.mjs";
import { etherscanTuple, portalTuple, toJson } from "./withdrawal.mjs";
import * as ui from "./ui.mjs";

const OUTPUT_DIR = "output";

// ---------------------------------------------------------------------------
// Shared: look at the withdrawal and decide what the next step is
// ---------------------------------------------------------------------------

export async function inspect({ l1, l2, txHash, index, sender }) {
  const loaded = await loadLegacyWithdrawal({ l2, txHash, index });
  const registered = await isRegisteredOnL2({ l2, withdrawal: loaded.withdrawal });
  const l1Status = await readL1Status({ l1, withdrawal: loaded.withdrawal, sender });
  return { ...loaded, registered, l1Status };
}

/**
 * Turn the raw facts into one of these states:
 *  delivered | relay-failed | finalized | not-registered | ready-to-prove | proven
 */
export function nextStep(result, nowSeconds = BigInt(Math.floor(Date.now() / 1000))) {
  const s = result.l1Status;
  if (s.relayed) return { state: "delivered" };
  if (s.failedRelay) return { state: "relay-failed" };
  if (s.finalized) return { state: "finalized" };
  if (!result.registered) return { state: "not-registered" };
  if (s.provenAt) {
    const readyAt = s.provenAt + s.proofDelay;
    return { state: "proven", readyAt, waiting: nowSeconds < readyAt };
  }
  return { state: "ready-to-prove" };
}

function showSummary(r) {
  ui.heading("Your withdrawal");
  const { info, withdrawal, message } = r;
  if (info.kind === "ETH") {
    ui.line(`  Type:       ETH withdrawal`);
    ui.line(`  Amount:     ${formatEther(info.amount)} ETH`);
    ui.line(`  Recipient:  ${info.to}   <- the funds go to this address, whoever sends the transactions`);
  } else if (info.kind === "ERC20") {
    ui.line(`  Type:       token withdrawal (ERC-20)`);
    ui.line(`  Token (L1): ${info.l1Token}`);
    ui.line(`  Amount:     ${info.amount} (raw units)`);
    ui.line(`  Recipient:  ${info.to}`);
  } else {
    ui.line(`  Type:       unrecognised message type (not verified by this tool)`);
  }
  ui.line(`  Legacy nonce: ${message.messageNonce}`);
  ui.line(`  Withdrawal hash: ${withdrawal.withdrawalHash}`);
  if (r.registered) {
    ui.ok("Verified: this exact withdrawal is registered on OP Mainnet.");
  } else {
    ui.bad("NOT registered on OP Mainnet (see below).");
  }
}

function explainState(step, r) {
  const s = r.l1Status;
  switch (step.state) {
    case "delivered":
      ui.ok("The funds were already delivered on Ethereum. Check the recipient's balance on Etherscan (Internal Transactions). Nothing left to do.");
      break;
    case "finalized":
      ui.ok("The portal says this withdrawal is already finalized.");
      ui.line("  (Anyone can finalize on your behalf, and automatic helpers sometimes do. That may be what happened here.)");
      ui.line("  Check the recipient's balance on etherscan.io (Internal Transactions tab).");
      break;
    case "relay-failed":
      ui.warn("The withdrawal was finalized, but the last delivery step failed. Your funds are NOT lost.");
      ui.line("  The message can be replayed on the L1CrossDomainMessenger. See 'If the final delivery failed' in the README.");
      break;
    case "not-registered":
      ui.bad("The rebuilt withdrawal is not registered on OP Mainnet, and nothing shows it as delivered.");
      ui.line("  Possible reasons: it was claimed long ago in the old system, it was not carried over by the Bedrock upgrade,");
      ui.line("  or this tool's reconstruction does not fit your case. Do NOT send any transaction. See 'Troubleshooting' in the README.");
      break;
    case "ready-to-prove":
      ui.ok("Next step: PROVE. Run:  npm run prove -- --tx <hash> --sender <your wallet>");
      break;
    case "proven": {
      ui.ok(`Already proven (${ui.utc(s.provenAt)}).`);
      if (step.waiting) {
        ui.line(`  The waiting period ends around ${ui.utc(step.readyAt)}. Come back after that and run CHECK again.`);
        ui.line("  Often the withdrawal is finalized for you automatically. If not, you will be told to run FINALIZE.");
      } else {
        ui.line("  The waiting period should be over and it has not been finalized yet.");
        ui.line("  Run:  npm run finalize -- --tx <hash> --sender <your wallet>");
        ui.line("  (If someone else finalizes it first, this check will say 'finalized' instead. That is fine.)");
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

export async function runCheck(ctx) {
  const r = await inspect(ctx);
  showSummary(r);
  ui.heading("Status");
  explainState(nextStep(r), r);
  if (!ctx.sender) {
    ui.line(ui.dim("\n(Tip: add --sender <your wallet> to also see whether YOU already proved it.)"));
  }
  return r;
}

// ---------------------------------------------------------------------------
// Dry run helper: simulate the Ethereum transaction. If it fails, nothing is sent.
// ---------------------------------------------------------------------------

const FAIL_HINT =
  "Common reasons: the waiting period is not over yet, the dispute game has not settled yet, " +
  "or you are not using the same wallet that proved it. Try again later; waiting costs nothing.";

async function dryRun({ l1, sender, functionName, args }) {
  try {
    await l1.simulateContract({
      account: sender,
      address: ADDRESSES.PORTAL,
      abi: portalAbi,
      functionName,
      args,
    });
  } catch (e) {
    throw new UserError(
      `The dry run FAILED, so do NOT send this transaction.\nReason: ${e.shortMessage ?? e.message}\n${FAIL_HINT}`
    );
  }
  let gas = null;
  let gasPrice = null;
  let balance = null;
  try {
    gas = await l1.estimateContractGas({ account: sender, address: ADDRESSES.PORTAL, abi: portalAbi, functionName, args });
    gasPrice = await l1.getGasPrice();
    balance = await l1.getBalance({ address: sender });
  } catch {
    // cost info is nice-to-have only
  }
  return { gas, gasPrice, balance };
}

function showCost({ gas, gasPrice, balance }) {
  if (gas === null) return;
  const cost = gas * gasPrice;
  ui.line(`  Estimated network fee: about ${formatEther(cost)} ETH (gas ${gas}), at today's gas price.`);
  if (balance < cost) {
    ui.warn(`Your sender wallet only holds ${formatEther(balance)} ETH on Ethereum mainnet. Add a little ETH there first (not on OP).`);
  } else {
    ui.ok(`Sender wallet balance on Ethereum: ${formatEther(balance)} ETH (enough for the fee).`);
  }
}

function etherscanSteps(functionName, sender, fields) {
  ui.heading("Send it with Etherscan");
  ui.line(`1. In your browser, type this address yourself (do not click links from anywhere else):`);
  ui.line(`   https://etherscan.io/address/${ADDRESSES.PORTAL}#writeProxyContract`);
  ui.line(`2. Click "Connect to Web3" and connect your wallet ${sender}.`);
  ui.line(`3. Find "${functionName}" and paste the fields below (everything after the colon).`);
  ui.line(`4. Click "Write". In the wallet pop-up check:`);
  ui.line(`     To = ${ADDRESSES.PORTAL}   |   Value = 0 ETH   |   fee close to the estimate above.`);
  ui.line(`   If anything looks different, reject it.\n`);
  for (const [name, value] of fields) ui.line(`${ui.bold(name)}:\n${value}\n`);
}

function saveJson(name, obj) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(file, toJson(obj, 2));
  return file;
}

// ---------------------------------------------------------------------------
// prove
// ---------------------------------------------------------------------------

export async function runProve(ctx) {
  const { l1, l2, sender, txHash, force } = ctx;
  const r = await inspect(ctx);
  showSummary(r);
  const step = nextStep(r);

  if (step.state === "proven" && !force) {
    ui.heading("Already proven");
    explainState(step, r);
    ui.line(ui.dim("\nProving again is only needed if the first proof was rejected. Add --force to do it anyway (it restarts the waiting period)."));
    return;
  }
  if (step.state !== "ready-to-prove" && step.state !== "proven") {
    ui.heading("Nothing to prove");
    explainState(step, r);
    return;
  }

  ui.heading("Building the proof");
  const latest = await l2.getBlockNumber();
  let game;
  try {
    game = await l1.getGame({ l2BlockNumber: latest - 7200n, targetChain: optimism });
  } catch (e) {
    throw new UserError(
      `Could not find a recent dispute game on Ethereum. Try again in a few minutes.\n(${e.shortMessage ?? e.message})`
    );
  }
  ui.line(`  Using dispute game #${game.index} (OP block ${game.l2BlockNumber})`);

  let built;
  try {
    built = await l2.buildProveWithdrawal({ account: sender, game, withdrawal: r.withdrawal });
  } catch (e) {
    throw new UserError(
      `Could not build the proof.\nReason: ${e.shortMessage ?? e.message}\n` +
        "If this mentions eth_getProof, your OP RPC does not support it: re-run with --l2-rpc <an Alchemy/Infura OP Mainnet URL>."
    );
  }

  const tuple = portalTuple(r.withdrawal);
  const args = [tuple, BigInt(game.index), built.outputRootProof, built.withdrawalProof];

  ui.heading("Dry run (nothing is sent)");
  const cost = await dryRun({ l1, sender, functionName: "proveWithdrawalTransaction", args });
  ui.ok("Dry run passed: the proof is valid.");
  showCost(cost);

  const p = built.outputRootProof;
  const fields = [
    ["_tx", etherscanTuple(tuple)],
    ["_disputeGameIndex", game.index.toString()],
    ["_outputRootProof", toJson([p.version, p.stateRoot, p.messagePasserStorageRoot, p.latestBlockhash])],
    ["_withdrawalProof", toJson(built.withdrawalProof)],
  ];
  etherscanSteps("proveWithdrawalTransaction", sender, fields);

  const file = saveJson(`${txHash.slice(0, 10)}-prove.json`, {
    contract: ADDRESSES.PORTAL,
    function: "proveWithdrawalTransaction",
    fields: Object.fromEntries(fields),
    calldata: encodeFunctionData({ abi: portalAbi, functionName: "proveWithdrawalTransaction", args }),
  });
  ui.line(`Saved a copy to ${file}`);
  ui.heading("After you send it");
  ui.line("  1. Write down the date. The portal enforces a waiting period of about 7 days.");
  ui.line("  2. Send the proof soon after generating it (the same day is best).");
  ui.line("  3. After the wait, run: npm run check -- --tx <hash> --sender <same wallet>");
  ui.line("     Withdrawals are often finalized automatically by third parties, so the funds may simply arrive.");
  ui.line("     If check says it is ready, run: npm run finalize -- --tx <hash> --sender <same wallet>");
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

export async function runFinalize(ctx) {
  const { l1, sender, txHash } = ctx;
  const r = await inspect(ctx);
  showSummary(r);
  const step = nextStep(r);

  if (step.state === "ready-to-prove") {
    ui.heading("Not proven yet");
    ui.bad("This sender wallet has not proven the withdrawal yet. Run the prove step first (with the same --sender).");
    ui.line("  If a DIFFERENT wallet proved it, re-run with that wallet as --sender.");
    return;
  }
  if (step.state !== "proven") {
    ui.heading("Nothing to finalize");
    explainState(step, r);
    return;
  }
  if (step.waiting) {
    ui.warn(`Expected to be ready after about ${ui.utc(step.readyAt)}. Running the dry run anyway.`);
  }

  const tuple = portalTuple(r.withdrawal);
  const args = [tuple];

  ui.heading("Dry run (nothing is sent)");
  const cost = await dryRun({ l1, sender, functionName: "finalizeWithdrawalTransaction", args });
  ui.ok("Dry run passed: ready to finalize.");
  showCost(cost);
  ui.line(ui.dim("  Note: the wallet may show a large gas LIMIT. You only pay for the gas actually used."));

  etherscanSteps("finalizeWithdrawalTransaction", sender, [["_tx", etherscanTuple(tuple)]]);
  const file = saveJson(`${txHash.slice(0, 10)}-finalize.json`, {
    contract: ADDRESSES.PORTAL,
    function: "finalizeWithdrawalTransaction",
    fields: { _tx: etherscanTuple(tuple) },
    calldata: encodeFunctionData({ abi: portalAbi, functionName: "finalizeWithdrawalTransaction", args }),
  });
  ui.line(`Saved a copy to ${file}`);
  ui.heading("After you send it");
  ui.line("  Open the recipient on etherscan.io, tab 'Internal Transactions': the funds arrive as soon as it confirms.");
  ui.line("  You can also re-run:  npm run check -- --tx <hash>");
}
