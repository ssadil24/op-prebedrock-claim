// End-to-end tests of the real CLI against a tiny fake JSON-RPC server (no internet needed).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { encodeEventTopics, toFunctionSelector } from "viem";
import { ADDRESSES, messagePassedEvent } from "../src/constants.mjs";
import { RECIPIENT, TX_HASH, rpcReceipt, sentMessageLog } from "./fixtures.mjs";

const run = promisify(execFile);
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");

const SEL = {
  sentMessages: toFunctionSelector("sentMessages(bytes32)"),
  finalized: toFunctionSelector("finalizedWithdrawals(bytes32)"),
  successful: toFunctionSelector("successfulMessages(bytes32)"),
  failed: toFunctionSelector("failedMessages(bytes32)"),
  proven: toFunctionSelector("provenWithdrawals(bytes32,address)"),
  delay: toFunctionSelector("proofMaturityDelaySeconds()"),
};

// What the fake chain currently "contains". Tests change this between runs.
const chain = { registered: true, finalized: false, provenAt: 0, receiptLogs: [sentMessageLog()] };

function rpc(method, params) {
  if (method === "eth_chainId") return "0xa";
  if (method === "eth_getTransactionReceipt") return rpcReceipt(chain.receiptLogs);
  if (method === "eth_call") {
    const data = (params[0].data ?? params[0].input ?? "0x").toLowerCase();
    const sel = data.slice(0, 10);
    if (sel === SEL.sentMessages) return word(chain.registered ? 1 : 0);
    if (sel === SEL.finalized) return word(chain.finalized ? 1 : 0);
    if (sel === SEL.successful || sel === SEL.failed) return word(0);
    if (sel === SEL.proven) return "0x" + "00".repeat(32) + BigInt(chain.provenAt).toString(16).padStart(64, "0");
    if (sel === SEL.delay) return word(604800);
  }
  throw new Error(`mock RPC: unhandled ${method}`);
}

let server;
let url;
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const msg = JSON.parse(body);
      const reply = (m) => {
        try {
          return { jsonrpc: "2.0", id: m.id, result: rpc(m.method, m.params) };
        } catch (e) {
          return { jsonrpc: "2.0", id: m.id, error: { code: -32000, message: e.message } };
        }
      };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(Array.isArray(msg) ? msg.map(reply) : reply(msg)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function cli(args) {
  try {
    const { stdout } = await run(
      "node",
      ["src/cli.mjs", ...args, "--tx", TX_HASH, "--l1-rpc", url, "--l2-rpc", url],
      { env: { ...process.env, NO_COLOR: "1" } }
    );
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.code, out: `${e.stdout}${e.stderr}` };
  }
}

test("check: a claimable withdrawal is verified and 'prove' is the next step", async () => {
  Object.assign(chain, { registered: true, finalized: false, provenAt: 0, receiptLogs: [sentMessageLog()] });
  const { code, out } = await cli(["check"]);
  assert.equal(code, 0, out);
  assert.match(out, /0\.066 ETH/);
  assert.match(out, new RegExp(RECIPIENT, "i"));
  assert.match(out, /Verified: this exact withdrawal is registered/);
  assert.match(out, /Next step: PROVE/);
});

test("check: not registered -> clear warning, no instructions to send anything", async () => {
  Object.assign(chain, { registered: false, finalized: false, provenAt: 0, receiptLogs: [sentMessageLog()] });
  const { out } = await cli(["check"]);
  assert.match(out, /NOT registered/);
  assert.match(out, /Do NOT send any transaction/);
});

test("check: already finalized is reported", async () => {
  Object.assign(chain, { registered: true, finalized: true, provenAt: 0, receiptLogs: [sentMessageLog()] });
  const { out } = await cli(["check"]);
  assert.match(out, /already finalized/);
});

test("prove: refuses to do anything when the withdrawal is already finalized", async () => {
  Object.assign(chain, { registered: true, finalized: true, provenAt: 0, receiptLogs: [sentMessageLog()] });
  const { code, out } = await cli(["prove", "--sender", RECIPIENT]);
  assert.equal(code, 0, out);
  assert.match(out, /Nothing to prove/);
});

test("finalize: tells you to prove first when no proof exists", async () => {
  Object.assign(chain, { registered: true, finalized: false, provenAt: 0, receiptLogs: [sentMessageLog()] });
  const { out } = await cli(["finalize", "--sender", RECIPIENT]);
  assert.match(out, /Not proven yet/);
});

test("regular post-Bedrock withdrawals are redirected to the official bridge", async () => {
  const passed = {
    address: ADDRESSES.L2_MESSAGE_PASSER,
    topics: encodeEventTopics({ abi: [messagePassedEvent], eventName: "MessagePassed", args: { nonce: 1n, sender: RECIPIENT, target: RECIPIENT } }),
    data: "0x",
    logIndex: 1,
  };
  Object.assign(chain, { receiptLogs: [sentMessageLog(0), passed] });
  const { code, out } = await cli(["check"]);
  assert.equal(code, 1);
  assert.match(out, /superbridge/i);
});

test("check: proven long ago and not finalized -> suggests finalize, mentions it may happen automatically", async () => {
  const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 86400;
  Object.assign(chain, { registered: true, finalized: false, provenAt: eightDaysAgo, receiptLogs: [sentMessageLog()] });
  const { out } = await cli(["check", "--sender", RECIPIENT]);
  assert.match(out, /Already proven/);
  assert.match(out, /waiting period should be over/);
  assert.match(out, /npm run finalize/);
  assert.match(out, /someone else finalizes/);
});

test("check: proven recently -> tells you to wait, then check again (it may be finalized automatically)", async () => {
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
  Object.assign(chain, { registered: true, finalized: false, provenAt: twoDaysAgo, receiptLogs: [sentMessageLog()] });
  const { out } = await cli(["check", "--sender", RECIPIENT]);
  assert.match(out, /run CHECK again/);
  assert.match(out, /finalized for you automatically/);
});

test("input validation gives friendly messages", async () => {
  const bad = await run("node", ["src/cli.mjs", "prove", "--tx", TX_HASH], { env: { ...process.env, NO_COLOR: "1" } }).catch((e) => e);
  assert.match(`${bad.stdout}${bad.stderr}`, /--sender/);
  const help = await run("node", ["src/cli.mjs", "--help"]);
  assert.match(help.stdout, /NEVER asks for a private key/);
});
