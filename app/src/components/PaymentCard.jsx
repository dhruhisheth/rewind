import { STATUS, formatAmount, formatDuration, personaOf, short } from "../chain.js";

const LABEL = {
  Pending: "In window",
  Claimed: "Settled",
  Released: "Released early",
  Rewound: "Rewound",
  Refused: "Refused",
};

export default function PaymentCard({ p, ctx, side, chainNow, act }) {
  const status = STATUS[Number(p.status)];
  const other = side === "outgoing" ? p.recipient : p.sender;
  const who = personaOf(other, ctx.knownAccounts);
  const total = Number(p.unlockAt - p.createdAt);
  const left = Math.max(0, Number(p.unlockAt) - chainNow);
  const open = status === "Pending" && left > 0;
  const ready = status === "Pending" && left === 0;
  const { rewind } = ctx;

  return (
    <li className={`payment ${status.toLowerCase()}`}>
      <Ring total={total} left={status === "Pending" ? left : 0} status={status} />
      <div className="p-main">
        <div className="p-line">
          <span className="p-dir">{side === "outgoing" ? "To" : "From"}</span>
          <strong>{who ? who.name : short(other)}</strong>
          {who && <span className="mono dim">{short(other)}</span>}
        </div>
        <div className="p-line">
          <span className="p-amt">{formatAmount(p.amount, p.token, ctx.usdc.target)}</span>
          {p.memo && <span className="p-memo">“{p.memo}”</span>}
        </div>
        <div className="p-line small">
          <span className={`status s-${status.toLowerCase()}`}>{ready ? "Ready" : LABEL[status]}</span>
          {open && <span className="dim">{formatDuration(left)} left to undo</span>}
          {ready && <span className="dim">window closed, anyone can settle</span>}
          {status !== "Pending" && total === 0 && <span className="dim">trusted, settled instantly</span>}
        </div>
      </div>
      <div className="p-actions">
        {side === "outgoing" && open && (
          <>
            <button className="rewind-btn" onClick={() => act("Rewinding", () => rewind.rewind(p.id))}>
              ⟲ Rewind
            </button>
            <button className="ghost small" onClick={() => act("Releasing", () => rewind.release(p.id))}>
              Release now
            </button>
          </>
        )}
        {side === "incoming" && status === "Pending" && (
          <button className="ghost small" onClick={() => act("Refusing", () => rewind.refuse(p.id))}>
            Not mine, refuse
          </button>
        )}
        {ready && (
          <button className="primary small" onClick={() => act("Settling", () => rewind.claim(p.id))}>
            Settle
          </button>
        )}
      </div>
    </li>
  );
}

function Ring({ total, left, status }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? left / total : 0;
  const glyph = { Claimed: "✓", Released: "✓", Rewound: "⟲", Refused: "↩" }[status];
  return (
    <svg className="ring" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} className="ring-bg" />
      {status === "Pending" && (
        <circle
          cx="22"
          cy="22"
          r={r}
          className="ring-fg"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 22 22)"
        />
      )}
      {glyph && (
        <text x="22" y="27" textAnchor="middle" className="ring-glyph">
          {glyph}
        </text>
      )}
    </svg>
  );
}
