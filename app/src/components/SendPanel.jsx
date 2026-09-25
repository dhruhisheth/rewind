import { useEffect, useState } from "react";
import { ZeroAddress, isAddress, parseUnits, getAddress } from "ethers";
import { PERSONAS, formatDuration, personaOf, short } from "../chain.js";
import { findLookalike } from "../lookalike.js";

const EXTRA = [
  { label: "Adaptive", seconds: 0 },
  { label: "At least 1 hour", seconds: 3600 },
  { label: "At least 1 day", seconds: 86400 },
];

export default function SendPanel({ ctx, paidHistory, incoming, act }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("eth");
  const [memo, setMemo] = useState("");
  const [minWindow, setMinWindow] = useState(0);
  const [risk, setRisk] = useState(null);
  const [ack, setAck] = useState(false);

  const valid = isAddress(to) && to.toLowerCase() !== ctx.address.toLowerCase();

  useEffect(() => {
    setAck(false);
    if (!valid) return setRisk(null);
    let live = true;
    (async () => {
      const [window, raw, settled] = await Promise.all([
        ctx.rewind.windowFor(ctx.address, to),
        ctx.rewind.reputationOf(to),
        ctx.rewind.settledBetween(ctx.address, to),
      ]);
      if (!live) return;
      // uint32 fields arrive as BigInt, which React won't render and === won't match
      const rep = Object.fromEntries(["settled", "rewinds", "distinctRewinders", "refused"].map((k) => [k, Number(raw[k])]));
      const lookalike = findLookalike(to, paidHistory);
      const dust = incoming.some((p) => p.sender.toLowerCase() === to.toLowerCase() && p.amount < 10n ** 12n);
      setRisk({ window: Number(window), rep, settled: Number(settled), lookalike, dust });
    })().catch(() => live && setRisk(null));
    return () => {
      live = false;
    };
  }, [to, valid, ctx, paidHistory, incoming]);

  const level = !risk
    ? null
    : risk.lookalike
      ? "danger"
      : risk.rep.distinctRewinders >= 2
        ? "danger"
        : risk.rep.distinctRewinders === 1 || risk.dust
          ? "caution"
          : risk.window === 0
            ? "trusted"
            : "new";
  const blocked = level === "danger" && !ack;
  const effectiveWindow = risk ? Math.max(risk.window, minWindow) : 0;

  const submit = (e) => {
    e.preventDefault();
    if (!valid || !amount || blocked) return;
    const recipient = getAddress(to.toLowerCase());
    act("Sending", async () => {
      if (token === "eth") {
        return ctx.rewind.send(recipient, ZeroAddress, 0, minWindow, memo, { value: parseUnits(amount, 18) });
      }
      const value = parseUnits(amount, 6);
      const spender = await ctx.rewind.getAddress();
      if ((await ctx.usdc.allowance(ctx.address, spender)) < value) {
        await (await ctx.usdc.approve(spender, value)).wait();
      }
      return ctx.rewind.send(recipient, await ctx.usdc.getAddress(), value, minWindow, memo);
    }).then(() => {
      setAmount("");
      setMemo("");
    });
  };

  return (
    <form className="card send" onSubmit={submit}>
      <h2>Send a payment</h2>

      <label>
        <span>Recipient</span>
        <input
          className="mono"
          placeholder="0x…"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      {ctx.knownAccounts.length > 0 && (
        <div className="quick">
          {ctx.knownAccounts.map((a, i) =>
            a.toLowerCase() === ctx.address.toLowerCase() ? null : (
              <button type="button" key={a} onClick={() => setTo(a)} className={PERSONAS[i].role === "scammer" ? "bad" : ""}>
                {PERSONAS[i].name}
              </button>
            ),
          )}
        </div>
      )}

      {risk && <RiskCard risk={risk} level={level} ctx={ctx} to={to} ack={ack} setAck={setAck} />}

      <div className="row">
        <label className="grow">
          <span>Amount</span>
          <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          <span>Asset</span>
          <select value={token} onChange={(e) => setToken(e.target.value)}>
            <option value="eth">ETH</option>
            <option value="usdc">mUSDC</option>
          </select>
        </label>
      </div>

      <label>
        <span>Memo</span>
        <input placeholder="What's it for?" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={80} />
      </label>

      <fieldset className="segmented">
        <legend>Rewind window</legend>
        {EXTRA.map((o) => (
          <button type="button" key={o.seconds} className={minWindow === o.seconds ? "on" : ""} onClick={() => setMinWindow(o.seconds)}>
            {o.label}
          </button>
        ))}
      </fieldset>

      <button className="primary wide" disabled={!valid || !amount || blocked}>
        {risk ? (effectiveWindow === 0 ? "Send instantly" : `Send · undo for ${formatDuration(effectiveWindow)}`) : "Send"}
      </button>
    </form>
  );
}

function RiskCard({ risk, level, ctx, to, ack, setAck }) {
  const who = personaOf(to, ctx.knownAccounts);
  const { rep } = risk;
  const title = {
    trusted: "Trusted payee",
    new: "New payee",
    caution: "Be careful",
    danger: "Stop and check",
  }[level];

  return (
    <div className={`risk ${level}`} aria-live="polite">
      <div className="risk-head">
        <span className="dot" />
        <strong>{title}</strong>
        <span className="risk-window">{risk.window === 0 ? "settles instantly" : `held ${formatDuration(risk.window)}`}</span>
      </div>
      <ul>
        {risk.lookalike && (
          <li className="alarm">
            This address <b>imitates one you've paid</b>. The first {risk.lookalike.prefix} and last {risk.lookalike.suffix}{" "}
            characters match <span className="mono">{short(risk.lookalike.address)}</span>
            {personaOf(risk.lookalike.address, ctx.knownAccounts) &&
              ` (${personaOf(risk.lookalike.address, ctx.knownAccounts).name})`}
            , but the middle is different. This is how address poisoning works.
            <AddressDiff real={risk.lookalike.address} fake={to} />
          </li>
        )}
        {risk.dust && <li>This address sent you a tiny "dust" payment, which is a common way to plant a fake in your history.</li>}
        {rep.distinctRewinders > 0 && (
          <li>
            <b>{rep.distinctRewinders}</b> {rep.distinctRewinders > 1 ? "different senders" : "sender"} rewound{" "}
            <b>{rep.rewinds}</b> payment{rep.rewinds > 1 ? "s" : ""} to this address. Its window is {rep.distinctRewinders + 1}× longer.
          </li>
        )}
        {risk.settled > 0 && (
          <li>
            You've completed {risk.settled} payment{risk.settled > 1 ? "s" : ""} to {who ? who.name : "this address"}
            {risk.window === 0 ? ", so it's trusted." : `. After ${3 - risk.settled} more, payments go through instantly.`}
          </li>
        )}
        {risk.settled === 0 && !risk.lookalike && <li>You've never paid this address before.</li>}
        <li className="dim">
          Public record: {rep.settled} settled · {rep.rewinds} rewound · {rep.refused} refused by them
        </li>
      </ul>
      {level === "danger" && (
        <label className="ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          I've checked the full address and still want to send
        </label>
      )}
    </div>
  );
}

function AddressDiff({ real, fake }) {
  const r = real.toLowerCase();
  const f = fake.toLowerCase();
  return (
    <div className="diff mono">
      <div>
        <span className="tag">paid</span>
        {[...r].map((c, i) => (
          <span key={i} className={c !== f[i] ? "d" : ""}>
            {c}
          </span>
        ))}
      </div>
      <div>
        <span className="tag">this</span>
        {[...f].map((c, i) => (
          <span key={i} className={c !== r[i] ? "d" : ""}>
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}
