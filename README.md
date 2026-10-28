# Claim stuck pre-Bedrock OP Mainnet withdrawals

A small command-line helper for one specific problem: **ETH (or tokens) you withdrew from OP Mainnet
to Ethereum before June 6, 2023 (the "Bedrock" upgrade), but never finished claiming.**

Those withdrawals usually don't show up in bridge apps like Superbridge, yet the funds are still claimable.
This tool rebuilds the withdrawal from your old transaction, checks it against the chain, builds the proof,
and gives you the exact values to paste into Etherscan. In my case only **one** transaction (the proof) had to be sent by hand:
the final "finalize" step was done automatically after the waiting period. That's not guaranteed, so you always `check` first.

> **The tool never asks for a private key or seed phrase and never sends a transaction itself.**
> It only reads public blockchain data and *dry-runs* transactions. You approve and send them from your own wallet.

It worked for me on a real 0.066 ETH withdrawal. It has **not** been tested on token (ERC-20)
withdrawals or unusual cases, so read the output carefully and see [Limitations](#limitations).

---

## Is this for me?

You are in the right place if **all** of these are true:

- You started a withdrawal **from OP Mainnet to Ethereum** in 2021, 2022 or before June 6, 2023.
- You never completed it on Ethereum, or you're not sure.
- A normal bridge app (e.g. superbridge.app) does not show it.

If your withdrawal is from June 2023 or later, use the official bridge instead. This tool will tell you so.

Not sure whether you have stuck funds? Checker sites exist (I used [stuckfunds.eth.limo](stuckfunds.eth.limo)), but I can't vouch for any
third-party site. Never enter a seed phrase anywhere, and double-check what a site tells you on Etherscan.

## What you need

1. **Your original withdrawal transaction hash on OP Mainnet.** Find it on
   [optimistic.etherscan.io](https://optimistic.etherscan.io): open the wallet's address and look for an old
   transaction (before June 2023) that sent funds to the *L2 Standard Bridge* (`0x4200…0010`) or called `withdraw`.
   It looks like `0x` followed by 64 characters.
2. **A "sender" wallet** with a little ETH **on Ethereum mainnet** (not OP) to pay the network fees.
   - It can be the same wallet the funds belong to, or any other wallet of yours.
   - Use the **same sender wallet for both steps** (prove and finalize).
   - The funds always go to the recipient inside the withdrawal, no matter who sends.
3. **Node.js 20 or newer** (free, from [nodejs.org](https://nodejs.org), pick the "LTS" version).
4. **About 7 days** between the two steps. This waiting period is built into the bridge.

**Cost:** one Ethereum transaction (prove), plus a second one (finalize) only if nobody finalizes it for you. In my
case the proof cost cents, but fees change with network traffic. The tool shows an estimate before you send anything.

## Setup (once)

Open a terminal (Windows: "Command Prompt" or PowerShell; Mac: "Terminal").

```bash
git clone <YOUR-REPO-URL>
cd op-prebedrock-claim
npm install
```

No git? Download the ZIP from GitHub, unzip it, open a terminal **inside** that folder, and run `npm install`.

> **Tip:** if `npm run … -- …` gives odd errors on Windows PowerShell, use the direct form instead, for example
> `node src/cli.mjs check --tx 0x…`, `node src/cli.mjs prove --tx 0x… --sender 0x…`.

## Step 1: Check (free, read-only)

```bash
npm run check -- --tx 0xYOUR_OP_WITHDRAWAL_TX_HASH
```

You should see your amount, the recipient address, and:

```
✔ Verified: this exact withdrawal is registered on OP Mainnet.
✔ Next step: PROVE
```

**Read the recipient address and amount.** If they aren't what you expect, stop.

If you see `NOT registered`, do not send anything. See [Troubleshooting](#troubleshooting).

## Step 2: Prove (Ethereum transaction #1)

```bash
npm run prove -- --tx 0xYOUR_OP_WITHDRAWAL_TX_HASH --sender 0xYOUR_SENDER_WALLET
```

The tool builds the proof and does a **dry run**. If the dry run fails, it tells you why and you send nothing.
If it passes, it prints instructions and four values. Then:

1. In your browser, **type** `etherscan.io/address/0xbEb5Fc579115071764c7423A4f12eDde41f106Ed` yourself
   (that's the official OP Mainnet *OptimismPortal*; compare it with [L2BEAT](https://l2beat.com) or OP's docs if you like).
2. Open **Contract → Write as Proxy Contract** and click **Connect to Web3**. Connect the sender wallet.
3. Open **`proveWithdrawalTransaction`** and paste the four values into the matching fields
   (`_tx`, `_disputeGameIndex`, `_outputRootProof`, `_withdrawalProof`). Paste exactly what the tool printed,
   including the square brackets and quotes. The `_withdrawalProof` box is labeled `bytes[]`; it takes the same bracketed list.
4. Click **Write**. In your wallet pop-up make sure that **To** is the portal address and **Value** is **0 ETH**.
   Reject anything that looks different.

Send it soon after generating it (the same day). Then **write down the date**.

## Step 3: Wait about 7 days

Nothing to do. Waiting costs nothing and nothing expires.

## Step 4: Check again (you may already be done)

After the waiting period, re-run the check **before** doing anything else:

```bash
npm run check -- --tx 0xYOUR_OP_WITHDRAWAL_TX_HASH --sender 0xSAME_SENDER_WALLET
```

Anyone is allowed to finalize a proven withdrawal on your behalf, and automatic helpers often do. In my case the
funds simply arrived and the finalize transaction showed up in the wallet history without being sent by hand. This isn't guaranteed,
and I don't know exactly who or what triggers it, so don't assume: check.

- If it says **finalized** or **delivered**: skip to Step 6.
- If it says the withdrawal is **proven and the waiting period is over**: continue with Step 5.

## Step 5: Finalize yourself (only if it wasn't done for you)

```bash
npm run finalize -- --tx 0xYOUR_OP_WITHDRAWAL_TX_HASH --sender 0xSAME_SENDER_WALLET
```

If the dry run passes, you get one value (`_tx`). Send it the same way as above, but with the function
**`finalizeWithdrawalTransaction`**. The wallet may show a big gas *limit*. You only pay for the gas actually used.

## Step 6: Confirm the funds arrived

Open the **recipient** address on etherscan.io and look at **Internal Transactions** for the incoming transfer
from the L1StandardBridge. You can also re-run `npm run check`.

---

## Troubleshooting

| What you see | What it means / what to do |
|---|---|
| `NOT registered on OP Mainnet` | Nothing to claim with this tool: the withdrawal may have been claimed long ago, or wasn't carried over. **Don't send anything.** Check the recipient's Ethereum history on Etherscan, and ask for help in the OP community (find it via optimism.io). |
| `regular (post-Bedrock) withdrawal` | Use [superbridge.app](https://superbridge.app) instead. |
| `Nothing to finalize` / "already finalized" | Good news: someone (often an automatic helper) finalized it for you. Check the recipient's balance on Etherscan. |
| `The dry run FAILED` when finalizing | Usually the waiting period isn't over, the dispute game hasn't settled, or you used a different sender wallet than for prove. Wait and retry. |
| `The dry run FAILED` when proving | Run the prove step again in a few minutes. It picks a fresh dispute game. |
| `eth_getProof` / network errors | The free public endpoints are busy or limited. Pass your own free endpoint: `--l2-rpc https://…` / `--l1-rpc https://…` (Alchemy and Infura both offer free OP Mainnet and Ethereum URLs). |
| "Several withdrawals in one transaction" | Re-run with `--index 0`, `--index 1`, … as the message suggests. |
| Finalized, but no funds | Run `npm run check`. If it says the delivery failed, see below. |

### If the final delivery failed

If `check` reports that the withdrawal was finalized but the delivery failed, **your funds are not lost**. The message sits in the
L1CrossDomainMessenger's failed-messages list and can be replayed by calling `relayMessage` there with the same values. This tool
doesn't automate that yet. Ask for help or open an issue, and share the output of `npm run check`.

## Safety rules

- **Never** share a seed phrase or private key. Nothing in this process needs one.
- **Type** Etherscan URLs yourself. Ignore DMs, "support" accounts and anyone offering to "help you claim".
- Read every wallet pop-up. A claim is a plain contract call with **Value 0**. It never needs "unlimited approvals" or "sign in to verify".
- Always do the dry run (the tool does it for you). If it fails, don't send.

## Options

```
--tx <hash>          your ORIGINAL withdrawal transaction on OP Mainnet
--sender <address>   wallet that sends the Ethereum transactions
--index <n>          only if a transaction contains several withdrawals
--l1-rpc <url>       Ethereum RPC (default: ethereum-rpc.publicnode.com)
--l2-rpc <url>       OP Mainnet RPC (default: mainnet.optimism.io)
--force              prove again even though a proof exists (restarts the wait)
```

`TX`, `SENDER`, `L1_RPC_URL` and `L2_RPC_URL` environment variables work as well.
Generated files are saved to `./output/` (ignored by git).

## How it works (for developers)

At the Bedrock upgrade, every pending legacy withdrawal was converted into a new-format withdrawal and stored in the
`L2ToL1MessagePasser`. Each converted withdrawal is:

| Field | Value |
|---|---|
| `nonce` | the legacy `messageNonce` (version 0) |
| `sender` | `L2CrossDomainMessenger` (`0x4200…0007`) |
| `target` | `L1CrossDomainMessenger` (`0x25ace71c…5fA1`) |
| `value` | the ETH amount from `finalizeETHWithdrawal`, else 0 |
| `data` | `relayMessage(nonce, legacySender, legacyTarget, value, 0, legacyMessage)` |
| `gasLimit` | `16 × len(data) + 200,000 + ⌊64 × 1,000,000 / 63⌋ + 40,000 + 40,000 + 5,000`, capped at 25M |

The tool reads the legacy `SentMessage` event from your old receipt, rebuilds this struct (`src/withdrawal.mjs`), and checks
`L2ToL1MessagePasser.sentMessages(hash)` on OP Mainnet. **That check is the safety gate**: if the hash is registered, the rebuild is
exactly right. Then it uses viem's OP Stack actions to build the proof against a recent dispute game, and simulates
`proveWithdrawalTransaction` / `finalizeWithdrawalTransaction` before printing the values. Finalizing is permissionless (the
funds go to the recipient encoded in the withdrawal), which is why a third party can complete it for you.

```
src/withdrawal.mjs  pure functions (rebuild, hash, gas limit)   <- unit-tested offline
src/chain.mjs       network reads (receipt, L2 registration, L1 status)
src/commands.mjs    check / prove / finalize flows
src/cli.mjs         argument parsing
test/               unit tests + end-to-end tests against a fake RPC server
```

Run the tests with `npm test` (no internet needed).

## Limitations

- OP Mainnet only. Other OP Stack chains (Base, etc.) launched after Bedrock and don't have this problem.
- ETH withdrawals are the tested case. Token (ERC-20) withdrawals follow the same migration rules in theory, and the on-chain
  registration check protects you, but they are untested.
- `prove` and `finalize` rely on viem's OP Stack helpers and the current OptimismPortal ABI. If OP upgrades the contracts, the
  dry run may start failing. Open an issue if so. viem is pinned to an exact version in `package.json` for that reason.
- This is an independent community tool, not affiliated with Optimism, and it isn't financial advice.

## Disclaimer

Use at your own risk. Verify contract addresses yourself. Read the code, since it's short. Provided "as is" under the MIT license.
