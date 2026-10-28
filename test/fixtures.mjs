// Synthetic fixtures (dummy recipient, dummy tx hash) shaped like a real pre-Bedrock ETH withdrawal.
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi } from "viem";
import { ADDRESSES, sentMessageEvent } from "../src/constants.mjs";

export const TX_HASH = "0x" + "ab".repeat(32);
export const RECIPIENT = "0x1111111111111111111111111111111111111111";
export const L1_STANDARD_BRIDGE = "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1";
export const L2_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010";
export const NONCE = 12345n;
export const AMOUNT = 66_000_000_000_000_000n; // 0.066 ETH

export const MESSAGE = encodeFunctionData({
  abi: parseAbi(["function finalizeETHWithdrawal(address,address,uint256,bytes)"]),
  functionName: "finalizeETHWithdrawal",
  args: [RECIPIENT, RECIPIENT, AMOUNT, "0x"],
});

export function sentMessageLog(logIndex = 0) {
  return {
    address: ADDRESSES.L2_MESSENGER,
    topics: encodeEventTopics({ abi: [sentMessageEvent], eventName: "SentMessage", args: { target: L1_STANDARD_BRIDGE } }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }, { type: "uint256" }, { type: "uint256" }],
      [L2_STANDARD_BRIDGE, MESSAGE, NONCE, 0n]
    ),
    logIndex,
  };
}

/** Receipt object as viem returns it (for unit tests). */
export const fakeReceipt = (logs = [sentMessageLog()]) => ({ status: "success", logs });

/** Receipt as raw JSON-RPC (for the mock server). */
export function rpcReceipt(logs = [sentMessageLog()]) {
  return {
    transactionHash: TX_HASH,
    transactionIndex: "0x0",
    blockHash: "0x" + "cd".repeat(32),
    blockNumber: "0x64",
    from: RECIPIENT,
    to: ADDRESSES.L2_MESSENGER,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    contractAddress: null,
    logsBloom: "0x" + "00".repeat(256),
    status: "0x1",
    type: "0x0",
    logs: logs.map((l, i) => ({
      ...l,
      blockNumber: "0x64",
      blockHash: "0x" + "cd".repeat(32),
      transactionHash: TX_HASH,
      transactionIndex: "0x0",
      logIndex: "0x" + (l.logIndex ?? i).toString(16),
      removed: false,
    })),
  };
}
