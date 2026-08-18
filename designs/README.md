# Client design worlds

One folder per client site, keyed by tenant slug: `designs/<slug>/DESIGN.md`. Each
DESIGN.md is that client's committed design world (palette, type, spacing, motion
and anti-references) in Impeccable's format, and it is the source of truth for how
that client's site is built and restyled.

Read the brand-law boundary in `PRODUCT.md` and the workflow in `CLAUDE.md` (the
tg-sites section) before designing. Load a client's world at the start of a session
with:

    node .claude/skills/impeccable/scripts/context.mjs --target designs/<slug>/

Refinement preserves the committed world; a redesign replaces the file. Never split
the difference. If a client has no folder here yet, agree the world with Andy and
write its DESIGN.md before designing, so no two client sites end up the same site
reskinned.
