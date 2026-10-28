import { parseAbi, parseAbiItem } from "viem";

// ---------------------------------------------------------------------------
// Contract addresses (OP Mainnet + Ethereum mainnet).
// Always double-check these against OP's docs or L2BEAT before sending anything.
// ---------------------------------------------------------------------------
export const ADDRESSES = {
  // L2 (OP Mainnet) predeploys
  L2_MESSENGER: "0x4200000000000000000000000000000000000007",
  L2_MESSAGE_PASSER: "0x4200000000000000000000000000000000000016",
  // L1 (Ethereum mainnet)
  L1_MESSENGER: "0x25ace71c97B33Cc4729CF772ae268934F7ab5fA1",
  PORTAL: "0xbEb5Fc579115071764c7423A4f12eDde41f106Ed",
};

export const DEFAULT_RPC = {
  l1: "https://ethereum-rpc.publicnode.com",
  l2: "https://mainnet.optimism.io",
};

// Fallback if the portal does not report its own proof maturity delay.
export const DEFAULT_PROOF_DELAY_SECONDS = 7n * 24n * 60n * 60n;

// ---------------------------------------------------------------------------
// ABIs (only the pieces we need)
// ---------------------------------------------------------------------------

// Emitted by the (legacy and current) L2CrossDomainMessenger.
export const sentMessageEvent = parseAbiItem(
  "event SentMessage(address indexed target, address sender, bytes message, uint256 messageNonce, uint256 gasLimit)"
);

// Emitted by the L2ToL1MessagePasser for normal (post-Bedrock) withdrawals.
// Pre-Bedrock withdrawals do NOT have this event in their receipt.
export const messagePassedEvent = parseAbiItem(
  "event MessagePassed(uint256 indexed nonce, address indexed sender, address indexed target, uint256 value, uint256 gasLimit, bytes data, bytes32 withdrawalHash)"
);

export const relayMessageAbi = parseAbi([
  "function relayMessage(uint256 _nonce, address _sender, address _target, uint256 _value, uint256 _minGasLimit, bytes _message)",
]);

export const finalizeEthAbi = parseAbi([
  "function finalizeETHWithdrawal(address _from, address _to, uint256 _amount, bytes _extraData)",
]);

export const finalizeErc20Abi = parseAbi([
  "function finalizeERC20Withdrawal(address _l1Token, address _l2Token, address _from, address _to, uint256 _amount, bytes _extraData)",
]);

export const messagePasserAbi = parseAbi([
  "function sentMessages(bytes32) view returns (bool)",
]);

export const l1MessengerAbi = parseAbi([
  "function successfulMessages(bytes32) view returns (bool)",
  "function failedMessages(bytes32) view returns (bool)",
]);

const withdrawalTuple =
  "(uint256 nonce, address sender, address target, uint256 value, uint256 gasLimit, bytes data)";

export const portalAbi = parseAbi([
  `function proveWithdrawalTransaction(${withdrawalTuple} _tx, uint256 _disputeGameIndex, (bytes32 version, bytes32 stateRoot, bytes32 messagePasserStorageRoot, bytes32 latestBlockhash) _outputRootProof, bytes[] _withdrawalProof)`,
  `function finalizeWithdrawalTransaction(${withdrawalTuple} _tx)`,
  "function finalizedWithdrawals(bytes32) view returns (bool)",
  "function provenWithdrawals(bytes32, address) view returns (address disputeGameProxy, uint64 timestamp)",
  "function proofMaturityDelaySeconds() view returns (uint256)",
]);
