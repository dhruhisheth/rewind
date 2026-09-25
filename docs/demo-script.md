# Demo video script (about 2½ minutes)

**Before recording:** start a fresh chain, then deploy and seed it (see the README), run `npm run dev`, open http://localhost:5173 at 1280×800, and zoom the browser to 110%.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Landing page | "Crypto payments are final. One wrong paste and your money is gone for good. Rewind adds an undo button, sized by trust." |
| 0:12 | Click **Open local demo** | "I'm Alice. The contract is live on a local chain, and these are real transactions." |
| 0:20 | Click **Bob**, enter 0.8, memo "October rent". Green card | "Bob is my landlord. I've paid him three times, so he's trusted and this settles instantly. No friction for payments I make every month." |
| 0:35 | Send. Row shows *Settled · trusted* | |
| 0:40 | Click **Carol**, send 1 ETH "concert tickets" | "Carol is new, so the payment waits in a short window. See the countdown ring." |
| 0:52 | Click **⟲ Rewind** | "Wrong person? One tap and the money is back. That rewind is now recorded on-chain." |
| 1:02 | Click **Carol** again. Card is amber, "held 4m" | "Because I rewound on her, Carol's window has doubled for everyone." |
| 1:10 | Click **Mallory**. Red card | "Mallory has been rewound by three *different* people. Her window is four times longer and sending is locked until I confirm. Nobody curated this blocklist. The victims' undo buttons built it." |
| 1:30 | Click **Simulate address poisoning**, open **Received** | "Now a real attack. A lookalike of Bob just sent me 1 wei. In my history it shows as 0x7099…79C8, identical to Bob." |
| 1:45 | Copy the fake, paste it as the recipient | "If I copy it by mistake, Rewind catches it. It imitates Bob. Here's every character that differs, and Send is blocked." |
| 2:00 | Switch persona to **Bob**, open Received | "Recipients can refuse payments they didn't expect, and honest bounces count in their favour." |
| 2:10 | Back to Alice, **+10 min**, **Settle** | "When the window ends, anyone can settle it. Keepers can automate this." |
| 2:20 | Contract in the editor, then the tests passing | "It's one Solidity contract with 13 tests and no admin keys. It works with ETH and any ERC-20. Next up: a smart-account module and a wallet Snap, so every payment gets an undo." |
