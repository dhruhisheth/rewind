# ⟲ Rewind — an undo button for crypto payments

> Crypto payments are final. Now they don't have to be.

Rewind is a smart-contract payment layer where every transfer first sits in a short **rewind window**. During that window the sender can pull it back and the recipient can bounce it. The window **adapts to trust**:

| Situation | What Rewind does |
|---|---|
| You've paid this address 3+ times without rewinding | **Instant.** Settles in the same transaction |
| First payment to a clean address | Held for the base window (2 min locally, 5 min on Sepolia) |
| *N* different senders have rewound payments to this address | Held **(N + 1)×** longer, capped at 7 days |
| The address imitates one you've paid (address poisoning) | **Blocked** until you confirm, with a character-level diff |

## Live on Sepolia

- **App:** https://dhruhisheth.github.io/rewind/ (connect MetaMask on the Sepolia network)
- **Rewind:** [`0x95Ad0FC04f5a0Eb1BB354dFA5Ba129153F433Ceb`](https://sepolia.etherscan.io/address/0x95Ad0FC04f5a0Eb1BB354dFA5Ba129153F433Ceb) (5-minute base window)
- **MockUSDC:** [`0xd17C9e6Bb00655E7c7540740Cd08F5Aa14Caa763`](https://sepolia.etherscan.io/address/0xd17C9e6Bb00655E7c7540740Cd08F5Aa14Caa763) (anyone can mint test dollars from the app)

## The problem

Irreversibility protects users from chargeback fraud, but it hands the advantage to scammers:

- **Address poisoning**: attackers mine vanity addresses matching the first and last characters of someone you pay, drop a dust transfer into your history, and wait for you to copy the wrong one. Wallets show `0x7099…79C8` for both.
- **Fat-finger and wrong-chain mistakes** can't be recovered.
- **Social-engineering scams** ("wallet support fee", "airdrop unlock gas") drain victims who realise minutes too late.

Existing answers are centralised (exchange freezes), heavyweight (escrow for every payment) or off-chain (blocklists that someone has to curate).

## The idea

1. **A short, rewindable window by default.** People usually realise something is wrong within minutes. That's when the money has to still be recoverable.
2. **Trust you earn removes the friction.** Payees you've settled with repeatedly get paid instantly, so regular payments stay fast.
3. **Rewinds become a decentralised scam signal.** Every rewind is recorded on-chain against the recipient, counted by *distinct* senders so one person can't grief an address. Nobody curates a blocklist: the victims' own undo button builds it, and it protects the next sender automatically by lengthening that address's window.
4. **Honest recipients are protected.** Bouncing a payment (`refuse`) counts in the recipient's favour, not against them.

## Architecture

```
contracts/                 Hardhat project
  contracts/Rewind.sol     the protocol: send / rewind / refuse / release / claim, adaptive windows, reputation
  contracts/MockUSDC.sol   6-decimal test stablecoin with a faucet
  test/Rewind.test.js      13 tests: windows, trust, reputation, caps, ERC-20, access control
  scripts/deploy.js        deploys, funds demo accounts, writes addresses + ABI into the app
  scripts/seed.js          sets up the demo story (trusted landlord, flagged scammer)
app/                       Vite + React + ethers v6 frontend
  src/lookalike.js         address-poisoning detector
  src/components/          send form with live risk card, payment list with countdown rings, demo controls
```

**Payment lifecycle:** `Pending` → `Claimed` (window elapsed, anyone can settle) · `Released` (sender confirmed early) · `Rewound` (sender pulled back) · `Refused` (recipient bounced).

**Window formula** (`Rewind.windowFor`):

```
if settledBetween[sender][recipient] >= 3 and sender never rewound on recipient:  0
else: min(baseWindow × (1 + distinctRewinders[recipient]), 7 days)
```

The sender can always ask for a *longer* window (`minWindow`), for example for a large purchase.

**Security notes:** checks-effects-interactions plus `ReentrancyGuard` on every state change; ERC-20 deposits are measured by balance delta so fee-on-transfer tokens can't overdraw the vault; custom errors for every failure path.

## Tech stack

- **Chain:** any EVM chain (tested on Hardhat, ready for Sepolia)
- **Contracts:** Solidity 0.8.24, OpenZeppelin 5 (`SafeERC20`, `ReentrancyGuard`), Hardhat, Chai
- **Frontend:** React 18, Vite 5, ethers v6, MetaMask or local unlocked accounts

## Run it locally

Requires Node 18+.

```bash
# 1. contracts
cd contracts
npm install
npm test                     # 13 passing
npm run node                 # terminal 1: local chain on :8545

# 2. deploy + seed (terminal 2)
cd contracts
npm run deploy:local         # writes app/src/deployments.json and abi.json
npm run seed:local           # Alice trusts Bob; Mallory has been rewound by 3 people

# 3. app (terminal 3)
cd app
npm install
npm run dev                  # http://localhost:5173 → "Open local demo"
```

Restarting the Hardhat node wipes the chain, so re-run the deploy and seed steps after a restart.

### Demo walkthrough (about 2 minutes)

1. **Trusted is instant.** As Alice, pick **Bob** and send `0.8 ETH`, "October rent". The card is green, "settles instantly".
2. **New payee has an undo.** Pick **Carol** and send `1 ETH`. It appears under *Sent* with a countdown ring. Press **⟲ Rewind** and the money is back.
3. **Scammer is flagged.** Pick **Mallory**. The card is red: 3 different senders rewound on this address and its window is 4× longer. Sending is locked until you tick the confirmation box.
4. **Address poisoning.** Press **Simulate address poisoning**. A lookalike of Bob sends Alice 1 wei, and under *Received* it shows as `0x7099…79C8`, exactly like Bob. Copy the fake and paste it as the recipient. Rewind blocks it and highlights every differing character.
5. **Recipient side.** Switch to **Bob** at the top. Incoming payments in their window can be refused ("Not mine").
6. **Settlement.** Press **+10 min**, then **Settle** on any pending payment.

### Testnet (Sepolia)

```bash
cd contracts
SEPOLIA_RPC_URL=https://... DEPLOYER_KEY=0x... npm run deploy:sepolia
cd ../app && npm run dev     # choose "Connect wallet" with MetaMask on Sepolia
```

Use a throwaway testnet key. The base window defaults to 5 minutes on public networks (override with `BASE_WINDOW=<seconds>`).

## Limitations and future scope

- **Recipients wait.** Merchants who need finality can ask senders to `release`, or build up trust. A future **merchant bond** could let a staked recipient opt into instant settlement.
- **Sybil resistance.** Distinct-sender counting makes reputation hard for one person to game, but a funded attacker can still create many sender wallets. Next steps are weighting rewinds by sender age and volume, and adding World ID / Gitcoin Passport attestations.
- **Wallet integration.** The lookalike detector belongs *in the wallet*. Next: a Snap / EIP-5792 capability so any dApp payment gets a rewind window.
- **Account abstraction.** Ship Rewind as an ERC-4337 / ERC-7579 module so a smart account's every outgoing transfer is rewindable by default.
- **Keepers.** Auto-settle expired payments with Chainlink Automation or Gelato.
- **Cross-chain.** One shared reputation registry across L2s.

## License

MIT
