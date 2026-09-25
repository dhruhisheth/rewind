import { BrowserProvider, Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";
import abi from "./abi.json";
import deployments from "./deployments.json";

export const LOCAL_RPC = "http://127.0.0.1:8545";
export const LOCAL_CHAIN = 31337;

// Hardhat's default accounts, given names so the demo reads like a story.
export const PERSONAS = [
  { name: "Alice", role: "you" },
  { name: "Bob", role: "landlord" },
  { name: "Carol", role: "friend" },
  { name: "Dave", role: "friend" },
  { name: "Erin", role: "friend" },
  { name: "Mallory", role: "scammer" },
];

export const STATUS = ["None", "Pending", "Claimed", "Released", "Rewound", "Refused"];

/** Connect to the local Hardhat node, acting as one of its unlocked accounts. */
export async function connectLocal(index) {
  const provider = new JsonRpcProvider(LOCAL_RPC, undefined, { pollingInterval: 1500 });
  const accounts = await provider.send("eth_accounts", []);
  const signer = await provider.getSigner(index);
  return build(provider, signer, accounts.slice(0, PERSONAS.length).map((a) => getAddress(a)));
}

/** Connect through an injected wallet such as MetaMask. */
export async function connectInjected() {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask in Chrome, Brave or Firefox to try Rewind on Sepolia.");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const current = Number(await window.ethereum.request({ method: "eth_chainId" }));
  if (!deployments[current]) {
    // put the wallet on Sepolia, where the public deployment lives
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
  }
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return build(provider, signer, []);
}

async function build(provider, signer, knownAccounts) {
  const { chainId } = await provider.getNetwork();
  const dep = deployments[chainId.toString()];
  if (!dep) throw new Error(`Rewind isn't deployed on chain ${chainId}. Run the deploy script for this network.`);
  return {
    provider,
    signer,
    address: await signer.getAddress(),
    chainId: Number(chainId),
    knownAccounts,
    baseWindow: dep.baseWindow,
    rewind: new Contract(dep.rewind, abi.Rewind, signer),
    usdc: new Contract(dep.usdc, abi.MockUSDC, signer),
  };
}

export function personaOf(address, knownAccounts) {
  const i = knownAccounts.findIndex((a) => a.toLowerCase() === address?.toLowerCase());
  return i >= 0 ? PERSONAS[i] : null;
}

export function short(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

export function formatAmount(amount, token, usdcAddress) {
  const isUsdc = token.toLowerCase() === usdcAddress.toLowerCase();
  const n = Number(formatUnits(amount, isUsdc ? 6 : 18));
  const shown = n > 0 && n < 0.0001 ? "<0.0001" : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return `${shown} ${isUsdc ? "mUSDC" : "ETH"}`;
}

export function formatDuration(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds)));
  if (seconds === 0) return "instant";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** Chain time can run ahead of the wall clock after fast-forwarding a local node. */
export async function chainClockOffset(provider) {
  const block = await provider.getBlock("latest");
  return Math.max(0, block.timestamp - Math.floor(Date.now() / 1000));
}

export async function fastForward(provider, seconds) {
  await provider.send("evm_increaseTime", [seconds]);
  await provider.send("evm_mine", []);
}

/** Turn a revert into something a person can read. */
export function explain(err) {
  const name = err?.revert?.name ?? err?.info?.error?.data?.message;
  const map = {
    InvalidRecipient: "That recipient isn't valid.",
    InvalidAmount: "Enter an amount above zero.",
    NotPending: "This payment has already settled.",
    NotSender: "Only the sender can do that.",
    NotRecipient: "Only the recipient can do that.",
    WindowClosed: "The rewind window has closed.",
    WindowOpen: "The rewind window is still open.",
  };
  if (name && map[name]) return map[name];
  if (err?.code === "ACTION_REJECTED") return "You rejected the transaction in your wallet.";
  return err?.shortMessage ?? err?.message ?? String(err);
}
