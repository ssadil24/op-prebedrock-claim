import test from "node:test";
import assert from "node:assert/strict";
import { toFunctionSelector } from "viem";
import {
  buildMigratedWithdrawal,
  describeMessage,
  etherscanTuple,
  ethValueFromMessage,
  hasMessagePassed,
  hashWithdrawal,
  legacyMessagesFromReceipt,
  migratedGasLimit,
  portalTuple,
} from "../src/withdrawal.mjs";
import { ADDRESSES, messagePassedEvent } from "../src/constants.mjs";
import { AMOUNT, L1_STANDARD_BRIDGE, L2_STANDARD_BRIDGE, MESSAGE, NONCE, RECIPIENT, fakeReceipt, sentMessageLog } from "./fixtures.mjs";
import { encodeEventTopics } from "viem";

test("reads the ETH amount out of a finalizeETHWithdrawal message", () => {
  assert.equal(ethValueFromMessage(MESSAGE), AMOUNT);
  assert.equal(ethValueFromMessage("0xdeadbeef"), 0n);
});

test("describes the recipient for the 'is this right?' check", () => {
  const d = describeMessage(MESSAGE);
  assert.equal(d.kind, "ETH");
  assert.equal(d.to.toLowerCase(), RECIPIENT.toLowerCase());
  assert.equal(d.amount, AMOUNT);
});

test("finds the legacy SentMessage event in a receipt", () => {
  const msgs = legacyMessagesFromReceipt(fakeReceipt());
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].messageNonce, NONCE);
  assert.equal(msgs[0].target.toLowerCase(), L1_STANDARD_BRIDGE.toLowerCase());
  assert.equal(msgs[0].sender.toLowerCase(), L2_STANDARD_BRIDGE.toLowerCase());
  assert.equal(msgs[0].message, MESSAGE);
});

test("ignores unrelated logs", () => {
  const other = { ...sentMessageLog(), address: "0x2222222222222222222222222222222222222222" };
  assert.equal(legacyMessagesFromReceipt(fakeReceipt([other])).length, 0);
});

test("detects regular (post-Bedrock) withdrawals via MessagePassed", () => {
  assert.equal(hasMessagePassed(fakeReceipt()), false);
  const passed = {
    address: ADDRESSES.L2_MESSAGE_PASSER,
    topics: encodeEventTopics({
      abi: [messagePassedEvent],
      eventName: "MessagePassed",
      args: { nonce: 1n, sender: RECIPIENT, target: RECIPIENT },
    }),
    data: "0x",
    logIndex: 1,
  };
  assert.equal(hasMessagePassed(fakeReceipt([passed])), true);
});

test("gas limit: standard ETH withdrawal (420 bytes of calldata) = 1,307,593", () => {
  // This exact value was confirmed on-chain for a real withdrawal of this shape.
  const w = buildMigratedWithdrawal(legacyMessagesFromReceipt(fakeReceipt())[0]);
  assert.equal((w.data.length - 2) / 2, 420);
  assert.equal(w.gasLimit, 1_307_593n);
  assert.equal(migratedGasLimit(w.data), 1_307_593n);
});

test("gas limit is capped at 25M", () => {
  assert.equal(migratedGasLimit("0x" + "ff".repeat(2_000_000)), 25_000_000n);
});

test("migrated withdrawal has the expected fixed fields", () => {
  const w = buildMigratedWithdrawal(legacyMessagesFromReceipt(fakeReceipt())[0]);
  assert.equal(w.nonce, NONCE);
  assert.equal(w.sender, ADDRESSES.L2_MESSENGER);
  assert.equal(w.target, ADDRESSES.L1_MESSENGER);
  assert.equal(w.value, AMOUNT);
  assert.equal(w.data.slice(0, 10), toFunctionSelector("relayMessage(uint256,address,address,uint256,uint256,bytes)"));
  assert.equal(w.withdrawalHash, hashWithdrawal(w));
});

test("hash changes if any field changes", () => {
  const w = buildMigratedWithdrawal(legacyMessagesFromReceipt(fakeReceipt())[0]);
  assert.notEqual(hashWithdrawal({ ...w, gasLimit: w.gasLimit + 1n }), w.withdrawalHash);
  assert.notEqual(hashWithdrawal({ ...w, nonce: w.nonce + 1n }), w.withdrawalHash);
});

test("rejects versioned (post-Bedrock) nonces", () => {
  const msg = legacyMessagesFromReceipt(fakeReceipt())[0];
  assert.throws(() => buildMigratedWithdrawal({ ...msg, messageNonce: 2n ** 240n + 1n }), /post-Bedrock/);
});

test("Etherscan tuple is a JSON array in field order with stringified numbers", () => {
  const w = buildMigratedWithdrawal(legacyMessagesFromReceipt(fakeReceipt())[0]);
  const parsed = JSON.parse(etherscanTuple(portalTuple(w)));
  assert.equal(parsed.length, 6);
  assert.equal(parsed[0], NONCE.toString());
  assert.equal(parsed[3], AMOUNT.toString());
  assert.equal(parsed[4], "1307593");
});
