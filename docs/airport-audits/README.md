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

**All 102 servable records audited as of 25 August 2026.** Every one carries two
cited sources and a Verified Date. Zero live records remain on the May 2026
stamp. 123 records sit at `In progress`, gated out of the picker and off every
client site until their own audit.

| Batch | Records | Audited | Log |
|---|---|---|---|
| Manchester (worked example) | 1 | 25 Aug 2026 | [MAN.md](MAN.md) |
| UK origins | 24 | 25 Aug 2026 | [UK-origins.md](UK-origins.md) |
| Spain and Greece | 40 (+7 elsewhere) | 25 Aug 2026 | [Spain-Greece.md](Spain-Greece.md) |
| USA | 14 | 25 Aug 2026 | [USA.md](USA.md) |
| Gulf, Turkey, North Africa | 17 | 25 Aug 2026 | [Gulf-North-Africa.md](Gulf-North-Africa.md) |
