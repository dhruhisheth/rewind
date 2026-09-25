import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import {
  LOCAL_CHAIN,
  PERSONAS,
  chainClockOffset,
  connectInjected,
  connectLocal,
  explain,
  fastForward,
  short,
} from "./chain.js";
import SendPanel from "./components/SendPanel.jsx";
import PaymentCard from "./components/PaymentCard.jsx";
import DevTools from "./components/DevTools.jsx";

export default function App() {
  const [ctx, setCtx] = useState(null);
  const [persona, setPersona] = useState(0);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("outgoing");
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [toast, setToast] = useState(null);

  const connect = useCallback(async (mode, index = 0) => {
    setError("");
    try {
      const c = mode === "local" ? await connectLocal(index) : await connectInjected();
      setCtx(c);
      setPersona(index);
    } catch (e) {
      setError(explain(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    const { rewind, usdc, provider, address } = ctx;
    const [outIds, inIds, eth, musdc, off] = await Promise.all([
      rewind.outgoingOf(address),
      rewind.incomingOf(address),
      provider.getBalance(address),
      usdc.balanceOf(address),
      chainClockOffset(provider),
    ]);
    const load = (ids) => Promise.all([...ids].reverse().map(async (id) => ({ id, ...(await rewind.getPayment(id)).toObject() })));
    const [outgoing, incoming] = await Promise.all([load(outIds), load(inIds)]);
    setOffset(off);
    setData({ outgoing, incoming, eth, musdc });
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    refresh().catch((e) => setError(explain(e)));
    const t = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [ctx, refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const reconnect = () => ctx && !ctx.knownAccounts.length && connect("injected");
    window.ethereum.on?.("accountsChanged", reconnect);
    window.ethereum.on?.("chainChanged", reconnect);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", reconnect);
      window.ethereum.removeListener?.("chainChanged", reconnect);
    };
  }, [ctx, connect]);

  const chainNow = now + offset;

  const act = useCallback(
    async (label, fn) => {
      setToast({ kind: "busy", text: `${label}…` });
      try {
        const tx = await fn();
        await tx?.wait?.();
        setToast({ kind: "ok", text: `${label} ✓` });
        await refresh();
      } catch (e) {
        setToast({ kind: "err", text: explain(e) });
      }
      setTimeout(() => setToast((t) => (t?.kind === "busy" ? t : null)), 3500);
    },
    [refresh],
  );

  // addresses this account has actually paid: the baseline for spotting lookalikes
  const paidHistory = useMemo(() => {
    const set = new Set();
    for (const p of data?.outgoing ?? []) if (p.status === 2n || p.status === 3n) set.add(p.recipient.toLowerCase());
    return [...set];
  }, [data]);

  if (!ctx) return <Landing onConnect={connect} error={error} />;

  const list = data?.[tab] ?? [];
  const pendingIn = data?.incoming.filter((p) => p.status === 1n).length ?? 0;
  const pendingOut = data?.outgoing.filter((p) => p.status === 1n).length ?? 0;
  const isLocal = ctx.chainId === LOCAL_CHAIN;

  return (
    <div className="shell">
      <header className="top">
        <Logo />
        <div className="top-right">
          <span className="pill">{isLocal ? "Local Hardhat" : `Chain ${ctx.chainId}`}</span>
          {ctx.knownAccounts.length ? (
            <div className="personas" role="tablist" aria-label="Act as">
              {PERSONAS.map((p, i) => (
                <button
                  key={p.name}
                  className={`persona ${i === persona ? "on" : ""} ${p.role === "scammer" ? "bad" : ""}`}
                  onClick={() => connect("local", i)}
                  title={`${p.name}, ${p.role}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <span className="pill mono">{short(ctx.address)}</span>
          )}
        </div>
      </header>

      <section className="balances">
        <div>
          <span className="label">Signed in as</span>
          <strong>{ctx.knownAccounts.length ? PERSONAS[persona].name : short(ctx.address)}</strong>
          <span className="mono dim">{short(ctx.address)}</span>
        </div>
        <div>
          <span className="label">ETH</span>
          <strong>{data ? Number(formatEther(data.eth)).toFixed(3) : "…"}</strong>
        </div>
        <div>
          <span className="label">mUSDC</span>
          <strong>{data ? Number(formatUnits(data.musdc, 6)).toLocaleString() : "…"}</strong>
          <button
            className="link"
            onClick={() => act("Minting 1,000 test mUSDC", () => ctx.usdc.faucet(ctx.address, 1_000n * 10n ** 6n))}
          >
            + get 1,000 test mUSDC
          </button>
        </div>
        <div>
          <span className="label">Base window</span>
          <strong>{ctx.baseWindow >= 60 ? `${ctx.baseWindow / 60} min` : `${ctx.baseWindow}s`}</strong>
        </div>
      </section>

      {isLocal && (
        <DevTools
          ctx={ctx}
          onForward={(s) => act(`Skipping ahead ${s / 60} min`, () => fastForward(ctx.provider, s))}
          act={act}
        />
      )}

      <main className="grid">
        <SendPanel ctx={ctx} paidHistory={paidHistory} incoming={data?.incoming ?? []} act={act} />

        <section className="card activity">
          <div className="tabs" role="tablist">
            <button className={tab === "outgoing" ? "on" : ""} onClick={() => setTab("outgoing")}>
              Sent {pendingOut > 0 && <span className="count">{pendingOut}</span>}
            </button>
            <button className={tab === "incoming" ? "on" : ""} onClick={() => setTab("incoming")}>
              Received {pendingIn > 0 && <span className="count">{pendingIn}</span>}
            </button>
          </div>
          {list.length === 0 ? (
            <p className="empty">{tab === "outgoing" ? "Nothing sent yet." : "Nothing received yet."}</p>
          ) : (
            <ul className="payments">
              {list.map((p) => (
                <PaymentCard key={p.id} p={p} ctx={ctx} side={tab} chainNow={chainNow} act={act} />
              ))}
            </ul>
          )}
        </section>
      </main>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function Logo() {
  return (
    <div className="logo">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
        <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="66 22" />
        <path d="M17 10 L11 16 L17 22 Z M24 10 L18 16 L24 22 Z" fill="var(--accent)" />
      </svg>
      <span>Rewind</span>
    </div>
  );
}

function Landing({ onConnect, error }) {
  return (
    <div className="landing">
      <Logo />
      <h1>
        Crypto payments are final.
        <br />
        <em>Now they don't have to be.</em>
      </h1>
      <p className="lede">
        Rewind holds every payment in a short window you can undo, sized by trust. People you pay regularly get paid instantly.
        Addresses that other senders have rewound are held longer, and lookalike addresses are flagged before you hit send.
      </p>
      <div className="cta">
        <button className="primary" onClick={() => onConnect("local", 0)}>
          Open local demo
        </button>
        <button className="ghost" onClick={() => onConnect("injected")}>
          Connect wallet
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <ol className="how">
        <li>
          <b>Send</b> ETH or tokens into a rewind window.
        </li>
        <li>
          <b>Rewind</b> it if something's wrong, or the recipient can <b>refuse</b> it.
        </li>
        <li>
          <b>Settle</b> automatically once the window closes, or release it early.
        </li>
      </ol>
    </div>
  );
}
