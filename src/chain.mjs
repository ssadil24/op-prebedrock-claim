// Everything that talks to the network lives here.
import { createPublicClient, http, keccak256 } from "viem";
import { mainnet, optimism } from "viem/chains";
import { publicActionsL1, publicActionsL2 } from "viem/op-stack";
import {
  ADDRESSES,
  DEFAULT_PROOF_DELAY_SECONDS,
  l1MessengerAbi,
  messagePasserAbi,
  portalAbi,
} from "./constants.mjs";
import {
  buildMigratedWithdrawal,
  describeMessage,
  hasMessagePassed,
  legacyMessagesFromReceipt,
} from "./withdrawal.mjs";

/** An error whose message is meant to be read by a (non-technical) person. */
export class UserError extends Error {}

export function makeClients({ l1Rpc, l2Rpc }) {
  const l1 = createPublicClient({ chain: mainnet, transport: http(l1Rpc) }).extend(
    publicActionsL1()
  );
  const l2 = createPublicClient({ chain: optimism, transport: http(l2Rpc) }).extend(
    publicActionsL2()
  );
  return { l1, l2 };
}

/** Refuse to run if viem's built-in portal address ever differs from the one we verified. */
export function assertKnownPortal() {
  const fromViem = optimism.contracts.portal[1].address;
  if (fromViem.toLowerCase() !== ADDRESSES.PORTAL.toLowerCase()) {
    throw new UserError(
      `Safety stop: the portal address in your viem version (${fromViem}) differs from the one this tool was written for (${ADDRESSES.PORTAL}). ` +
        "Check the current OptimismPortal address on L2BEAT / OP docs before continuing."
    );
  }
}

/** Fetch the old L2 transaction and rebuild the migrated withdrawal from it. */
export async function loadLegacyWithdrawal({ l2, txHash, index }) {
  let receipt;
  try {
    receipt = await l2.getTransactionReceipt({ hash: txHash });
  } catch (e) {
    if (e?.name === "TransactionReceiptNotFoundError") {
      throw new UserError(
        "That transaction was not found on OP Mainnet. Make sure you copied the transaction hash of the withdrawal on OP Mainnet (optimistic.etherscan.io), not an Ethereum one."
      );
    }
    throw e;
  }
  if (receipt.status !== "success") {
    throw new UserError("That transaction failed on OP Mainnet, so there is nothing to claim from it.");
  }
  if (hasMessagePassed(receipt)) {
    throw new UserError(
      "This is a regular (post-Bedrock) withdrawal, not a legacy one. Use the official bridge (for example superbridge.app) to prove and finalize it."
    );
  }
  const messages = legacyMessagesFromReceipt(receipt);
  if (messages.length === 0) {
    throw new UserError(
      "No cross-chain message was found in that transaction. It does not look like a withdrawal to Ethereum."
    );
  }
  let message;
  if (messages.length === 1) {
    message = messages[0];
  } else if (index === undefined) {
    const lines = messages
      .map((m, i) => `  --index ${i}   nonce ${m.messageNonce}`)
      .join("\n");
    throw new UserError(
      `This transaction contains ${messages.length} withdrawals. Re-run with --index to pick one:\n${lines}`
    );
  } else {
    message = messages[index];
    if (!message) throw new UserError(`--index ${index} does not exist (0 to ${messages.length - 1}).`);
  }
  const withdrawal = buildMigratedWithdrawal(message);
  return { receipt, message, withdrawal, info: describeMessage(message.message) };
}

/** Is the rebuilt withdrawal really registered on OP Mainnet? (This is the key correctness check.) */
export function isRegisteredOnL2({ l2, withdrawal }) {
  return l2.readContract({
    address: ADDRESSES.L2_MESSAGE_PASSER,
    abi: messagePasserAbi,
    functionName: "sentMessages",
    args: [withdrawal.withdrawalHash],
  });
}

/** Where is this withdrawal on the Ethereum side? */
export async function readL1Status({ l1, withdrawal, sender }) {
  const hash = withdrawal.withdrawalHash;
  const relayHash = keccak256(withdrawal.data);

  const [finalized, relayed, failedRelay] = await Promise.all([
    l1.readContract({ address: ADDRESSES.PORTAL, abi: portalAbi, functionName: "finalizedWithdrawals", args: [hash] }),
    l1.readContract({ address: ADDRESSES.L1_MESSENGER, abi: l1MessengerAbi, functionName: "successfulMessages", args: [relayHash] }),
    l1.readContract({ address: ADDRESSES.L1_MESSENGER, abi: l1MessengerAbi, functionName: "failedMessages", args: [relayHash] }),
  ]);

  let provenAt = null;
  let provenKnown = false;
  if (sender) {
    try {
      const [, timestamp] = await l1.readContract({
        address: ADDRESSES.PORTAL,
        abi: portalAbi,
        functionName: "provenWithdrawals",
        args: [hash, sender],
      });
      provenKnown = true;
      if (timestamp > 0n) provenAt = timestamp;
    } catch {
      // best effort only
    }
  }

  let proofDelay = DEFAULT_PROOF_DELAY_SECONDS;
  try {
    proofDelay = await l1.readContract({
      address: ADDRESSES.PORTAL,
      abi: portalAbi,
      functionName: "proofMaturityDelaySeconds",
    });
  } catch {
    // keep the default
  }

  return { finalized, relayed, failedRelay, provenAt, provenKnown, proofDelay };
}
