// Pure functions: no network access in this file, so everything here is unit-tested offline.
import {
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  toEventSelector,
} from "viem";
import {
  ADDRESSES,
  finalizeErc20Abi,
  finalizeEthAbi,
  messagePassedEvent,
  relayMessageAbi,
  sentMessageEvent,
} from "./constants.mjs";

const lower = (s) => s.toLowerCase();

/**
 * Does this receipt contain a *new-format* withdrawal (MessagePassed event)?
 * If yes, it is a regular post-Bedrock withdrawal and normal bridge apps can claim it.
 */
export function hasMessagePassed(receipt) {
  const topic = toEventSelector(messagePassedEvent);
  return receipt.logs.some(
    (l) =>
      lower(l.address) === lower(ADDRESSES.L2_MESSAGE_PASSER) &&
      l.topics?.[0] && lower(l.topics[0]) === lower(topic)
  );
}

/** Extract every SentMessage event emitted by the L2CrossDomainMessenger. */
export function legacyMessagesFromReceipt(receipt) {
  const found = [];
  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(ADDRESSES.L2_MESSENGER)) continue;
    try {
      const ev = decodeEventLog({
        abi: [sentMessageEvent],
        data: log.data,
        topics: log.topics,
      });
      found.push({
        logIndex: log.logIndex,
        target: ev.args.target,
        sender: ev.args.sender,
        message: ev.args.message,
        messageNonce: ev.args.messageNonce,
      });
    } catch {
      // a different event from the same contract: ignore
    }
  }
  return found;
}

/** ETH amount carried by the withdrawal: only finalizeETHWithdrawal carries value. */
export function ethValueFromMessage(message) {
  try {
    const { args } = decodeFunctionData({ abi: finalizeEthAbi, data: message });
    return args[2];
  } catch {
    return 0n;
  }
}

/** Human-readable description of what the withdrawal pays out (for the "is this right?" check). */
export function describeMessage(message) {
  try {
    const { args } = decodeFunctionData({ abi: finalizeEthAbi, data: message });
    return { kind: "ETH", from: args[0], to: args[1], amount: args[2] };
  } catch {
    // not an ETH withdrawal
  }
  try {
    const { args } = decodeFunctionData({ abi: finalizeErc20Abi, data: message });
    return {
      kind: "ERC20",
      l1Token: args[0],
      l2Token: args[1],
      from: args[2],
      to: args[3],
      amount: args[4],
    };
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Gas limit given to migrated withdrawals at the Bedrock upgrade.
 * Mirrors MigrateWithdrawalGasLimit in OP's `op-chain-ops` migration code:
 *   16 gas per calldata byte + baseGas-style overhead (assuming 1,000,000 inner gas), capped at 25M.
 */
export function migratedGasLimit(dataHex) {
  const dataBytes = BigInt(hexToBytes(dataHex).length);
  const overhead =
    200_000n + // RelayConstantOverhead
    (64n * 1_000_000n) / 63n + // EIP-150 dynamic overhead
    40_000n + // RelayCallOverhead
    40_000n + // RelayReservedGas
    5_000n; // RelayGasCheckBuffer
  const gas = dataBytes * 16n + overhead;
  return gas > 25_000_000n ? 25_000_000n : gas;
}

export function hashWithdrawal(w) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint256, address, address, uint256, uint256, bytes"),
      [w.nonce, w.sender, w.target, w.value, w.gasLimit, w.data]
    )
  );
}

/**
 * Rebuild the "migrated" Bedrock withdrawal from a legacy SentMessage event.
 * (The Bedrock upgrade converted every pending legacy withdrawal into this form.)
 */
export function buildMigratedWithdrawal({ target, sender, message, messageNonce }) {
  if (messageNonce >= 2n ** 240n) {
    throw new Error(
      "This message nonce is versioned (post-Bedrock). It is not a legacy withdrawal."
    );
  }
  const value = ethValueFromMessage(message);
  // Legacy nonces are "version 0", so the versioned nonce equals the plain nonce.
  const data = encodeFunctionData({
    abi: relayMessageAbi,
    functionName: "relayMessage",
    args: [messageNonce, sender, target, value, 0n, message],
  });
  const withdrawal = {
    nonce: messageNonce,
    sender: ADDRESSES.L2_MESSENGER,
    target: ADDRESSES.L1_MESSENGER,
    value,
    gasLimit: migratedGasLimit(data),
    data,
  };
  withdrawal.withdrawalHash = hashWithdrawal(withdrawal);
  return withdrawal;
}

/** The 6-field struct the OptimismPortal expects. */
export const portalTuple = (w) => ({
  nonce: w.nonce,
  sender: w.sender,
  target: w.target,
  value: w.value,
  gasLimit: w.gasLimit,
  data: w.data,
});

/** JSON that works for BigInt values (used for Etherscan fields and saved files). */
export const toJson = (v, space) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), space);

/** Etherscan's tuple input format: a JSON array in field order. */
export const etherscanTuple = (t) =>
  toJson([t.nonce, t.sender, t.target, t.value, t.gasLimit, t.data]);
