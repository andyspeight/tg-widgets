/**
 * Making a designed home page the client's own, one slot at a time.
 *
 * THE THING THAT CLOSES THE GAP Andy named. The AI builder assembles pages from
 * a library of generic sections, so it gets better with every fix but never
 * reaches the ten hand-built homepages he approved - because it never touches
 * them. This does. When the theme designer picks one of the first ten pairings
 * it has also picked that pairing's designed home (theme-design.ts), and this
 * seeds the site's home page from that committed design and rewrites only its
 * WORDS to be about the client. The layout, the colour, the type, the spacing,
 * the pictures - every design decision somebody made by hand - is kept exactly.
 *
 * HOW A DESIGNED HOME IS EDITABLE AT ALL. Each is a frozen `imported` block
 * whose markup carries {{tg:KEY}} slots, with a `fields` list naming each slot
 * (key, kind, label, value) and a `content` map holding overrides. The renderer
 * substitutes content[key] ?? field.value at draw time (lib/import/slots.ts).
 * So personalising a home is writing new values into `content` for the text
 * slots - exactly the channel a client's own edit uses, escaped the same way.
 * Nothing here reaches the markup directly.
 *
 * WHAT IS AND IS NOT REWRITTEN. Text slots only. Image slots keep the design's
 * own pictures (licensed, chosen to sit in that exact layout - a stock swap
 * makes a designed page worse, not better). Link slots keep the design's own
 * anchors. And the model is told, hard, to invent nothing: no price, no award,
 * no named person, no ATOL number the profile did not give it. A slot it has
 * nothing true to say for keeps the design's own words.
 */

import { importFields } from '../content/imported';
import type { Section } from '../content/schema';
import type { SiteSettings } from '../settings/schema';
import { HOUSE_RULES, profileBlock } from './prompt';
import { toText } from './copy';

/** A text slot on the page, addressed by the block it lives in. */
export interface HomeSlot {
  /** Index into the page's sections-flattened block list. */
  block: number;
  key: string;
  /** What the slot is for, from the design (its label), to steer the rewrite. */
  label: string;
  /** The design's own words, the length and register to match. */
  value: string;
}

/**
 * The id the model is addressed by.
 *
 * A slot KEY (t1, u3) is unique only within one imported block, and a designed
 * home is many imported blocks each numbering from t1 again - so t1 names the
 * nav brand on one block, a heading on another, the footer on a third. Keying
 * the rewrite by the bare key fanned one answer across all of them and
 * collapsed the page's copy. The id carries the block, so every slot on the
 * page is distinct: "b3-t5".
 */
export function slotId(slot: HomeSlot): string {
  return `b${slot.block}-${slot.key}`;
}

/** Walk one section's blocks in the same order applyHomeCopy will. */
function blocksOf(sections: Section[]): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const section of sections) {
    for (const row of section.rows) {
      for (const column of row.columns) {
        for (const block of column.blocks as Array<Record<string, unknown>>) {
          blocks.push(block);
        }
      }
    }
  }
  return blocks;
}

/** The longest a slot's rewrite may be. A hero line is short; a paragraph is not. */
const MAX_SLOT = 600;
/** Skip a slot longer than this: it is a legal block or a long-read, not brand copy. */
const MAX_SOURCE = 2000;
/** The cap on slots offered in one call, so a very rich design cannot blow the prompt. */
const MAX_SLOTS = 120;

/**
 * Every rewritable text slot on the page.
 *
 * Text kind only, and only slots with real words in them: an empty slot has
 * nothing to match and a purely numeric or symbol slot (a rating, an arrow)
 * is design furniture, not copy. Ordered by block then by the field order the
 * design declared, which is the order a reader meets them.
 */
export function homeTextSlots(sections: Section[]): HomeSlot[] {
  const slots: HomeSlot[] = [];
  blocksOf(sections).forEach((block, index) => {
    if (block.type !== 'imported') return;
    for (const field of importFields(block.props as Record<string, unknown>)) {
      if (field.kind !== 'text') continue;
      const value = field.value.trim();
      if (value.length === 0 || value.length > MAX_SOURCE) continue;
      if (!/[a-zA-Z]/.test(value)) continue;
      if (slots.length >= MAX_SLOTS) break;
      slots.push({ block: index, key: field.key, label: field.label, value: field.value });
    }
  });
  return slots;
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export const HOME_RULES = `You are given the TEXT of a hand-designed travel homepage, one slot at a time, and your job is to rewrite each slot so the page reads as THIS company's own - while changing nothing about how it looks.

- Rewrite EACH slot to suit the company in the profile: its name, its position, the places it sells. The design's words are for a different company; yours are for this one.
- MATCH THE LENGTH AND THE ROLE of the original. A two-word nav label stays two words. A short hero line stays a short line. A paragraph stays a paragraph. The design's spacing was set for these lengths, and a slot that doubles in length breaks the layout it sits in.
- Where the original is the DESIGN'S OWN BRAND NAME, put the company's name. Where it is a menu label (Home, About, Contact), keep the label unless the company plainly calls that page something else.
- INVENT NOTHING, and KEEP NONE OF THE DESIGN'S OWN INVENTED FACTS. The design ships with realistic-looking placeholders - a specific ATOL or ABTA number, a named testimonial, a price, a street address, a founding year. Those belong to no real company. You must neither invent your own nor keep the design's.
  - A regulated claim (ATOL, ABTA, financial protection): make it GENERAL. "ATOL 11284" becomes "ATOL protected", "ABTA Y6427" becomes "ABTA member". Never a number.
  - A testimonial or named quotation: unless the profile gives you a real one, rewrite it as an unattributed statement of the promise, with no person's name and no place-and-date. A named quote nobody said is a lie on the page.
  - A price, a founding year, an award, a statistic the profile did not give: remove the specific. "Four nights from £4,850" becomes "Tailor-made stays"; "Est. 2011" becomes the company name or a general line.
  - An address or phone: use the contact facts below if they are given, otherwise make the slot a general invitation ("Get in touch") rather than the design's own address.
- A slot that is ordinary brand copy (a heading, a paragraph, a nav label) and that you have nothing sharper to say for: return its original words UNCHANGED. Keeping the design's own wording beats padding. This applies ONLY to copy, never to the invented specifics above.
- House voice throughout: warm, plain, UK English, no em dashes.`;

export const HOME_OUTPUT_SHAPE = `Return a JSON object and NOTHING else. No prose, no markdown fences. One entry per slot you are rewriting, keyed by the slot id EXACTLY as given (they look like "b3-t5"):

{ "b3-t5": "Halcyon Bay", "b0-t6": "Tailor-made Caribbean travel", "b1-t8": "..." }

Every value is plain text, no markup. Omit a slot to keep its original words. Include only slot ids that appear in the list you were given.`;

/**
 * The real contact facts, so an address or phone slot can carry the client's
 * own rather than the design's placeholder. Only what is set; a blank field
 * says nothing, which the rules read as "make it a general invitation".
 */
export function contactFacts(settings: SiteSettings): string {
  const parts: string[] = [];
  const address = [
    settings.streetAddress,
    settings.addressLocality,
    settings.addressRegion,
    settings.postalCode,
    settings.addressCountry,
  ].map((line) => (line ?? '').trim()).filter(Boolean);
  if (address.length) parts.push(`Address: ${address.join(', ')}`);
  if ((settings.telephone ?? '').trim()) parts.push(`Phone: ${settings.telephone.trim()}`);
  if (parts.length === 0) return '';
  return `The company's real contact details, for the address and phone slots only:\n${parts.join('\n')}`;
}

export function buildHomeSystemPrompt(settings: SiteSettings): string {
  const facts = contactFacts(settings);
  return [HOUSE_RULES, HOME_RULES, HOME_OUTPUT_SHAPE, profileBlock(settings), facts]
    .filter(Boolean)
    .join('\n\n');
}

/** The slots as the model sees them: id, what it is for, and the words to match. */
export function buildHomeUserPrompt(company: string, slots: HomeSlot[]): string {
  const intro = company
    ? `Rewrite this homepage for "${company}". Here are its text slots:`
    : 'Rewrite this homepage for the company in the profile. Here are its text slots:';
  const lines = slots.map((slot) => `- ${slotId(slot)} (${slot.label}): ${slot.value}`);
  return `${intro}\n\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Reading the answer, and applying it
// ---------------------------------------------------------------------------

export type HomeCopyResult =
  | { ok: true; copy: Record<number, Record<string, string>> }
  | { ok: false; error: string };

/**
 * The model's answer, made safe and addressed back to blocks.
 *
 * Same posture as every other fill: the answer is text from a model, trusted no
 * further than its own slot. A returned key must be a slot that was actually
 * offered (so a hallucinated id cannot write a new override), the value must be
 * a string, and it is capped. The map is keyed by block index then slot key, so
 * applyHomeCopy can write each override into the block it belongs to without
 * re-deriving anything. Values are NOT escaped here: the renderer escapes every
 * slot by its kind at substitution time, and escaping twice is the &#39; bug.
 */
export function homeCopyFromModel(raw: string, slots: HomeSlot[]): HomeCopyResult {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The answer was not JSON.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The answer was not an object.' };
  }
  const answer = parsed as Record<string, unknown>;

  // Every offered slot by its QUALIFIED id, so each resolves to exactly one
  // (block, key). A hallucinated or unoffered id resolves to nothing.
  const offered = new Map<string, { block: number; key: string }>();
  for (const slot of slots) {
    offered.set(slotId(slot), { block: slot.block, key: slot.key });
  }

  const copy: Record<number, Record<string, string>> = {};
  for (const [id, value] of Object.entries(answer)) {
    const target = offered.get(id);
    if (!target || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    const capped = [...trimmed].slice(0, MAX_SLOT).join('');
    (copy[target.block] ??= {})[target.key] = capped;
  }

  return { ok: true, copy };
}

/**
 * Write the rewrites into the page's imported blocks.
 *
 * Copy on write: a fresh sections array, and each touched block a fresh object
 * with a merged `content` map. The design's existing content (there usually is
 * none on a freshly seeded home) is kept and the rewrites layered over it, so a
 * slot the model left alone keeps whatever was there. Only real slot keys the
 * block actually offers are written - importFields is the allow-list - so a
 * stale block index or a key the block does not have writes nothing.
 */
export function applyHomeCopy(
  sections: Section[],
  copy: Record<number, Record<string, string>>,
): Section[] {
  let index = -1;
  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((block) => {
          index += 1;
          const rewrites = copy[index];
          if (!rewrites || (block as { type?: string }).type !== 'imported') return block;

          const props = (block as { props: Record<string, unknown> }).props;
          const keys = new Set(importFields(props).filter((f) => f.kind === 'text').map((f) => f.key));
          const current = (props.content && typeof props.content === 'object' && !Array.isArray(props.content)
            ? { ...(props.content as Record<string, string>) }
            : {}) as Record<string, string>;

          let wrote = false;
          for (const [key, value] of Object.entries(rewrites)) {
            if (!keys.has(key)) continue;
            current[key] = value;
            wrote = true;
          }
          if (!wrote) return block;

          return { ...block, props: { ...props, content: current } };
        }),
      })),
    })),
  })) as Section[];
}

/**
 * Scrub a regulated licence NUMBER from any text, whoever wrote it.
 *
 * The one fabrication the prompt cannot be fully trusted to catch and the one
 * that matters most, because it is a regulated claim: an ATOL or ABTA number
 * belonging to another company. "ATOL 11284" becomes "ATOL protected", "ABTA
 * Y6427" becomes "ABTA member". A bare mention with no number is left alone.
 */
export function scrubLicenceNumber(text: string): string {
  return text
    // 1. A parenthetical that CONTAINS the licence token: "(ATOL 11371)".
    //    The token is required, so an ordinary "(7 nights)" is left alone.
    .replace(/\s*\((?:ATOL|ABTA)\s+(?:No\.?\s*)?[A-Z]?\d[\dA-Z ]*\)/gi, '')
    // 2. A code parenthetical that FOLLOWS the token: "ABTA (Y6512)" -> "ABTA".
    //    Drop the code, keep the word, so "a member of ABTA (Y6512)" reads
    //    "a member of ABTA" and not "a member of ABTA member".
    .replace(/\b(ATOL|ABTA)\s*\((?:No\.?\s*)?[A-Z]?\d[\dA-Z ]*\)/gi, '$1')
    // 3. A bare licence number. The run ENDS on a digit, so it never eats the
    //    trailing space before the next word.
    .replace(/\bATOL\s*(?:No\.?|Number|#)?\s*:?\s*\d(?:[\d ]*\d)?/gi, 'ATOL protected')
    .replace(/\bABTA\s*(?:No\.?|Number|#)?\s*:?\s*[A-Z]?\d[\dA-Z]*/gi, 'ABTA member')
    // Tidy the seams a removal can leave.
    .replace(/ {2,}/g, ' ')
    .replace(/ ([.,;])/g, '$1');
}

/** An email address anywhere in a line. */
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Scrub a text slot: the licence numbers above, plus any email address.
 *
 * The designed homes carry a realistic placeholder email on a fictional domain
 * (studio@aurelia-escapes.co.uk). The rules ask the model to fix it, but that
 * is discretion, and an email is a deterministic pattern - so a fake one is
 * removed for certain, to the client's own if the profile gives one, otherwise
 * a general invitation.
 */
export function scrubContactText(text: string, ownEmail: string): string {
  const withLicence = scrubLicenceNumber(text);
  return withLicence.replace(EMAIL, (match) =>
    ownEmail && match.toLowerCase() === ownEmail.toLowerCase() ? match : ownEmail || 'Get in touch',
  );
}

/**
 * The final safety net: no fake licence number ships, in a slot the model
 * changed OR one it left as the design's own.
 *
 * Runs over EVERY text field's effective value (its override, or the design's
 * value when there is no override) and, where scrubbing changes it, writes the
 * scrubbed text back as an override. So a home shown with the design's own
 * placeholder words still cannot carry another company's ATOL number.
 */
export interface NeutraliseOpts {
  /** The client's real email, if the profile gives one. Blank means none. */
  ownEmail?: string;
  /** The client's real phone digits, for a tel: link. Blank means none. */
  ownPhone?: string;
  /** Where a fabricated contact link should point instead: the contact page. */
  contactHref?: string;
}

/** Digits (and a leading +) of a phone number, for a tel: href. */
function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
}

/**
 * The deterministic safety net over a seeded home: no fabricated regulated
 * claim and no fabricated contact detail ships, whatever the model did.
 *
 * Runs over EVERY imported block. Text slots are scrubbed of licence numbers
 * and placeholder emails (scrubContactText). CONTACT LINK slots - a mailto: or
 * tel: the model never gets to rewrite - are pointed at the client's own where
 * the profile gives it, otherwise at the contact page, so a visitor never
 * reaches a fictional address or number the design shipped with.
 */
export function neutraliseFabricated(sections: Section[], opts: NeutraliseOpts = {}): Section[] {
  const ownEmail = (opts.ownEmail ?? '').trim();
  const ownTel = telHref(opts.ownPhone ?? '');
  const fallbackHref = opts.contactHref ?? '';

  return sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((block) => {
          if ((block as { type?: string }).type !== 'imported') return block;
          const props = (block as { props: Record<string, unknown> }).props;
          const fields = importFields(props);
          if (fields.length === 0) return block;

          const content = (props.content && typeof props.content === 'object' && !Array.isArray(props.content)
            ? { ...(props.content as Record<string, string>) }
            : {}) as Record<string, string>;

          let changed = false;
          for (const field of fields) {
            const current = typeof content[field.key] === 'string' ? content[field.key] : field.value;

            if (field.kind === 'text') {
              const scrubbed = scrubContactText(current, ownEmail);
              if (scrubbed !== current) {
                content[field.key] = scrubbed;
                changed = true;
              }
              continue;
            }

            if (field.kind === 'link') {
              const lower = current.trim().toLowerCase();
              let replacement: string | null = null;
              if (lower.startsWith('mailto:')) {
                const addr = current.trim().slice(7);
                if (!(ownEmail && addr.toLowerCase() === ownEmail.toLowerCase())) {
                  replacement = ownEmail ? `mailto:${ownEmail}` : fallbackHref;
                }
              } else if (lower.startsWith('tel:')) {
                replacement = ownTel || fallbackHref;
              }
              if (replacement !== null && replacement !== current) {
                content[field.key] = replacement;
                changed = true;
              }
            }
          }
          if (!changed) return block;
          return { ...block, props: { ...props, content } };
        }),
      })),
    })),
  })) as Section[];
}

/** The plain-text words a rewrite carries, for a length sanity check in tests. */
export function slotText(value: unknown): string {
  return toText(value);
}
