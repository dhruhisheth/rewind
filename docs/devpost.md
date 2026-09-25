# Rewind: an undo button for crypto payments

*Paste each section into the matching Devpost field.*

## Tagline

Crypto payments are final. Now they don't have to be. Undo windows sized by trust, and a scam signal that the victims build themselves.

## Inspiration

Every banking app has an undo, and no crypto wallet does. A mistyped address, a fake "support agent" or a poisoned lookalike address in your history costs you everything, permanently. We wanted to add reversibility without bringing back chargeback fraud or making everyday payments slow.

## Problem statement

Blockchain transfers are irreversible by design. That protects merchants, but it leaves ordinary users defenceless against:

- **Address poisoning.** Attackers mine a vanity address matching the first and last characters of someone you pay, plant it in your history with a dust transfer, and wait for you to copy it. Wallets show both as `0x7099…79C8`.
- **Social engineering.** Fake support fees and airdrop "unlock gas" scams, where victims realise minutes too late.
- **Plain mistakes.** A wrong contact, a wrong amount or a typo.

Today's fixes are centralised (exchange freezes), slow for everyone (escrow for every payment) or need someone to curate them (blocklists).

## What it does

Rewind holds each payment in a short **rewind window** before it settles. During the window:

- the **sender** can *rewind* it (full refund) or *release* it early,
- the **recipient** can *refuse* it (bounce it back).

After the window, anyone can settle it to the recipient.

The window **adapts to trust**:

| Situation | Window |
|---|---|
| You've paid this address 3+ times and never rewound on it | **Instant**, settled in the same transaction |
| First payment to a clean address | Base window |
| *N* different senders have rewound payments to it | (N + 1) × base, capped at 7 days |
| It imitates an address you've paid | Sending is blocked until you confirm, with a character-level diff |

**The innovation: the victims build the blocklist.** Every rewind is recorded on-chain against the recipient and counted by *distinct* senders, so one person can't grief an honest address. Nobody curates anything. Each victim's undo automatically protects the next sender, because that address's window gets longer and the app explains why. Honest recipients who bounce a payment they didn't expect are credited, not penalised.

## How we built it

- **Smart contract** (`Rewind.sol`, Solidity 0.8.24): ETH and any ERC-20; `send / rewind / refuse / release / claim`; adaptive `windowFor()`; on-chain reputation (settled, rewinds, distinct rewinders, refused); per-pair trust counters.
- **Security:** OpenZeppelin `ReentrancyGuard` and `SafeERC20`, checks-effects-interactions, balance-delta accounting for fee-on-transfer tokens, custom errors, and no admin keys or proxy.
- **Tests:** 13 Hardhat/Chai tests covering windows, trust, reputation, the 7-day cap, ERC-20 and access control.
- **Frontend:** React + Vite + ethers v6. A live risk card while you type an address, a client-side **address-poisoning detector** that compares against addresses you've actually *paid* (so a dust sender can't make itself "known"), countdown rings, and one-tap rewind.
- **Demo tooling:** a seeded local chain with personas (Alice, Bob the trusted landlord, Mallory the scammer), time fast-forward, and a one-click *real* address-poisoning simulation that impersonates a vanity lookalike and sends a dust payment.

## Challenges

- Balancing safety against friction. A fixed delay on every payment would make daily use miserable, so the window had to be adaptive and per pair.
- Making the reputation hard to grief: counting distinct senders rather than raw rewinds, and never letting a sender who rewound on an address count it as trusted.
- Chain time and wall time drift apart after fast-forwarding a dev chain, so the countdowns follow block time.

## What we learned

A small amount of reversibility, applied only where trust is missing, removes most of the damage from the most common scams without touching the payments people make every day.

## What's next

- An ERC-4337 / ERC-7579 **smart-account module**, so every outgoing transfer is rewindable by default
- A **MetaMask Snap** that brings the lookalike detector to every dApp
- **Sybil resistance**: weight rewinds by sender age and volume and by proof-of-personhood attestations
- **Merchant bonds**: staked recipients opt into instant settlement
- Keeper-based auto-settlement and a reputation registry shared across L2s

## Built with

solidity · hardhat · openzeppelin · ethereum · ethers.js · react · vite · javascript

## Links

- GitHub: https://github.com/dhruhisheth/rewind
- Live app (Sepolia, MetaMask): https://dhruhisheth.github.io/rewind/
- Demo video: https://youtu.be/QyWzOnt0S5g
- Pitch deck: [deck URL or PDF]
