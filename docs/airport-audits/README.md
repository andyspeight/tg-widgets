# Airport verification logs

One file per airport, written at the time of the audit. Each records every
fact-bearing claim, the two independent sources that confirm it, what was found
wrong, and anything that could not be pinned by two agreeing sources and was
therefore softened rather than guessed.

These exist because the table spent three months claiming 230 records were
"Verified" with no evidence anywhere that anyone had verified them. The Verified
Date was written at creation rather than after checking, so nothing downstream
could tell an audited record from an empty one. A log here is what makes that
claim checkable.

## The rules these logs enforce

- Two independent sources per fact-bearing claim, at least one dated within
  twelve months. Two pages from the same outlet do not count.
- If two authoritative sources disagree, the claim is softened to a rule and a
  range with the month checked, never split down the middle and never guessed.
- Volatile figures (taxi fares, lounge day passes, drop-off charges) carry the
  month they were checked. They rot fastest and cause the errors that reach a
  customer at a taxi rank.
- Forward-looking claims with no corroborating source are removed, not
  rephrased. An unsourced prediction is not content.
- Verified Date is only ever written by an audit. Never at creation.

## Status

| Airport | Audited | Log |
|---|---|---|
| MAN Manchester | 25 Aug 2026 | [MAN.md](MAN.md) |
