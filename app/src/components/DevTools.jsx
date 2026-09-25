import { useState } from "react";
import { JsonRpcSigner, ZeroAddress, getAddress } from "ethers";
import { makeLookalike } from "../lookalike.js";

/** Local-chain-only controls for demoing time-dependent and attack flows. */
export default function DevTools({ ctx, onForward, act }) {
  const [twin, setTwin] = useState(null);

  // Stage an address-poisoning attack on the current account: mint an address
  // that looks like Bob's, impersonate it on the local node, and have it send
  // us a 1-wei payment so it appears in our history.
  const poison = () =>
    act("Planting a lookalike of Bob", async () => {
      const bob = ctx.knownAccounts[1];
      const fake = getAddress(makeLookalike(bob).toLowerCase());
      const { provider, rewind } = ctx;
      await provider.send("hardhat_impersonateAccount", [fake]);
      await provider.send("hardhat_setBalance", [fake, "0x56BC75E2D63100000"]);
      const signer = new JsonRpcSigner(provider, fake);
      const tx = await rewind.connect(signer).send(ctx.address, ZeroAddress, 0, 0, "", { value: 1n });
      await tx.wait();
      await provider.send("hardhat_stopImpersonatingAccount", [fake]);
      setTwin(fake);
      return null;
    });

  return (
    <aside className="dev">
      <span className="label">Demo controls · local chain only</span>
      <div className="dev-row">
        <button className="ghost small" onClick={() => onForward(60)}>
          +1 min
        </button>
        <button className="ghost small" onClick={() => onForward(600)}>
          +10 min
        </button>
        <button className="ghost small" onClick={poison}>
          Simulate address poisoning
        </button>
        {twin && (
          <button className="ghost small mono" onClick={() => navigator.clipboard?.writeText(twin)} title="Copy the fake address">
            copy fake {twin.slice(0, 6)}…{twin.slice(-4)}
          </button>
        )}
      </div>
    </aside>
  );
}
