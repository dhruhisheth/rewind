// Address-poisoning detection.
//
// Attackers generate a vanity address whose first and last few characters match
// someone you pay, then plant it in your history with a dust transfer. Wallets
// truncate addresses to 0x1234…abcd, so the fake looks identical and gets copied.
// We compare a recipient against every address in your history and flag any that
// share the visible edges but differ in the middle.

const EDGE = 4; // hex chars users actually glance at on each side

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
}

/**
 * @param {string} candidate address about to be paid
 * @param {string[]} history addresses the user has transacted with
 * @returns {{ address: string, prefix: number, suffix: number } | null} the address it imitates
 */
export function findLookalike(candidate, history) {
  const c = candidate.toLowerCase().slice(2);
  let best = null;
  for (const known of history) {
    const k = known.toLowerCase().slice(2);
    if (k === c) return null; // an exact match is a real contact, not an imitation
    const prefix = commonPrefix(c, k);
    const suffix = commonPrefix([...c].reverse().join(""), [...k].reverse().join(""));
    // three matching chars on both visible edges is ~1 in 16.7M by chance
    if (prefix >= EDGE - 1 && suffix >= EDGE - 1 && (!best || prefix + suffix > best.prefix + best.suffix)) {
      best = { address: known, prefix, suffix };
    }
  }
  return best;
}

/** A poisoned twin of `address` for the demo: same edges, different middle. */
export function makeLookalike(address) {
  const hex = address.slice(2);
  let middle = "";
  for (let i = 0; i < hex.length - 2 * EDGE; i++) middle += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  return `0x${hex.slice(0, EDGE)}${middle}${hex.slice(-EDGE)}`;
}
