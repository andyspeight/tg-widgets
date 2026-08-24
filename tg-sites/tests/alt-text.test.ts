/**
 * Alt text: the prompt, the picture, and the two gates around them.
 *
 * WHAT IS ACTUALLY AT RISK, and it is not whether the sentence is any good.
 *
 * The first risk is that we send a client's PICTURE to a third party. The action
 * takes an id off the wire and hands the image at that id to Anthropic, so the
 * id has to be resolved against this tenant's own bank before anything leaves
 * the building. Without that lookup a guessed id would have another client's
 * photograph described and the description returned to whoever asked.
 *
 * The second is subtler and is the one somebody would "improve" later: THE
 * COMPANY PROFILE MUST NOT GO INTO THE ALT TEXT PROMPT. Handed the profile, a
 * model writes "a couple enjoying a luxury Someshop escape in Crete", which is
 * a brochure caption and, to somebody who cannot see the photograph, a lie:
 * none of the brand is in the picture and the model does not know it is Crete.
 * Every other AI call in the product deliberately includes the profile, so
 * excluding it here looks like an oversight and is the opposite.
 *
 * The rest, the length cap and the "no Image of" rule, are about the sentence
 * being usable, and they are cheap to check so they are here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { altPrompt, ALT_RULES, HOUSE_RULES, MAX_ALT, systemPrompt } from '../lib/ai/prompt';
import { DEFAULT_SETTINGS } from '../lib/settings/schema';

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '..', ...parts), 'utf8');
}

/**
 * The body of describeImageAction and nothing else.
 *
 * Bounded at the next top-level export rather than at the end of the file,
 * because app/actions/ai.ts holds three actions and a slice to the end reads
 * the wrong one's decisions as this one's.
 */
function describeAction(): string {
  const source = read('app', 'actions', 'ai.ts');
  const start = source.indexOf('export async function describeImageAction');
  const after = source.indexOf('\nexport ', start + 10);
  return after > start ? source.slice(start, after) : source.slice(start);
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

describe('the rules an alt text writer is given', () => {
  it('bans the opening that wastes the first three words', () => {
    // A screen reader already says it is an image, so "Image of" is read twice.
    expect(ALT_RULES).toMatch(/Image of/i);
    expect(ALT_RULES).toMatch(/do not begin/i);
  });

  it('names the length it will be cut to, so the model is not surprised by it', () => {
    expect(ALT_RULES).toContain(String(MAX_ALT));
  });

  /*
   * THE ONE THAT MATTERS. A model that guesses a place name writes confident
   * nonsense, and alt text is read by exactly the person who cannot check it.
   */
  it('forbids guessing at anything not visible', () => {
    expect(ALT_RULES).toMatch(/never guess/i);
    expect(ALT_RULES).toMatch(/only what is actually visible/i);
  });

  it('asks for the sentence and nothing else', () => {
    expect(ALT_RULES).toMatch(/nothing else/i);
  });
});

describe('what is sent with the picture', () => {
  it('passes the filename as a hint that may be wrong', () => {
    const prompt = altPrompt('elounda-bay-sunset.jpg');
    expect(prompt).toContain('elounda-bay-sunset.jpg');
    // Labelled as a hint, or a model works "img 4471" into the sentence.
    expect(prompt).toMatch(/may.*meaningless|only if/i);
  });

  it('copes with a file that has no useful name at all', () => {
    expect(altPrompt('').trim().length).toBeGreaterThan(0);
    expect(altPrompt('')).not.toContain('called ""');
  });

  it('caps the filename, since it arrives from an upload', () => {
    expect(altPrompt(`${'x'.repeat(500)}.jpg`).length).toBeLessThan(400);
  });
});

/*
 * THE DECISION THIS FILE EXISTS TO PROTECT.
 *
 * Every other AI call in the product includes the client's profile, so leaving
 * it out here looks like a bug and is the opposite. If somebody "fixes" it, alt
 * text becomes marketing copy and the people it is written for get a sentence
 * about a brand that is not in the photograph.
 */
describe('the company profile and the alt text prompt', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    companyName: 'Someshop Travel',
    companyAbout: 'A high street agency in Leeds.',
    toneOfVoice: 'Warm and chatty.',
  };

  it('is in the writing assistant, which is about the client', () => {
    const system = systemPrompt(settings);
    expect(system).toContain('Someshop Travel');
    expect(system).toContain('Warm and chatty.');
  });

  it('is NOT in the alt text rules, which are about the picture', () => {
    expect(ALT_RULES).not.toContain('Someshop');
    expect(ALT_RULES).not.toMatch(/tone of voice/i);
  });

  /*
   * BOUNDED TO THIS ONE FUNCTION. The first version sliced from
   * describeImageAction to the end of the file, which was fine until
   * writeSeoAction was added below it on 1 Aug 2026: that one DOES call
   * systemPrompt, correctly, because a search description is about the business.
   * The check failed on the right grounds against the wrong text.
   */
  it('and the describer builds the alt prompt without ever calling systemPrompt', () => {
    /*
     * MOVED, NOT WEAKENED. The call itself lives in lib/ai/alt.ts since the
     * publish path needed the same one (#239); a second copy of it would have
     * been two boundaries free to drift. The rule it protects is unchanged and
     * is now asserted where the call is.
     */
    const describer = read('lib', 'ai', 'alt.ts');

    expect(describer).toContain('ALT_RULES');
    expect(describer).not.toContain('systemPrompt(');
    // The house rules DO apply: a harbour is not a harbor.
    expect(describer).toContain('HOUSE_RULES');
    // And the action reaches the model only through it.
    expect(describeAction()).toContain('describePicture(');
  });

  it('keeps the house rules worth applying, since they carry the UK English', () => {
    expect(HOUSE_RULES).toMatch(/UK English|British/i);
  });
});

// ---------------------------------------------------------------------------
// The action, read as source
// ---------------------------------------------------------------------------

describe('what the action does before a picture leaves the building', () => {
  const action = describeAction();

  /*
   * THE CROSS-TENANT CHECK. The caller sends an id and we send the picture at
   * that id to a third party. getMediaItem runs inside the tenant's policy, so
   * an id belonging to somebody else comes back as not found, exactly as a
   * made-up one does.
   */
  it('resolves the id against this tenant own bank, never trusts it', () => {
    expect(action).toContain('await getMediaItem(site.tenantId, id)');
    expect(action).toContain('if (!item)');
  });

  it('refuses membership first, before it reads what was sent', () => {
    const requireAt = action.indexOf('await requireSite()');
    const readAt = action.indexOf('const fields =');
    expect(requireAt).toBeGreaterThan(-1);
    expect(requireAt).toBeLessThan(readAt);
  });

  /*
   * The slot is taken BEFORE the model is called, so a call that fails still
   * counts. Otherwise a request that reliably errors is a request outside the
   * limit, and the charge lands anyway.
   */
  it('takes the daily slot before it spends any money', () => {
    // The ordering guarantee is the cost control, and it is unchanged: the slot
    // is claimed before the describer is reached. Only the callee's name moved.
    const claimAt = action.indexOf('claimRequest(');
    const askAt = action.indexOf('describePicture(');
    expect(claimAt).toBeGreaterThan(-1);
    expect(askAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(askAt);
  });

  it('caps the answer as well as asking for a cap in the prompt', () => {
    // Asserted where the cleaning is now. A prompt is a request; this is the
    // boundary, and there is one of it rather than two.
    expect(read('lib', 'ai', 'alt.ts')).toContain('.slice(0, MAX_ALT)');
  });

  /*
   * IT RETURNS A SENTENCE, IT DOES NOT SAVE ONE. A model that looked at a
   * photograph and wrote straight into the database would be one whose mistakes
   * are already published.
   */
  it('never writes what it wrote', () => {
    expect(action).not.toContain('setMediaAlt');
  });
});

describe('what the picker does with it', () => {
  const source = read('components', 'media', 'MediaPicker.tsx');
  const editor = source.slice(source.indexOf('function AltEditor'));
  const body = editor.slice(0, editor.indexOf('\n}\n'));

  it('finally calls the action that had sat unused since the bank shipped', () => {
    expect(body).toContain('setMediaAltAction(item.id, next)');
  });

  /*
   * ON BLUR, NEVER ON KEYSTROKE. A save per character is a request per
   * character, and a description is a sentence rather than a setting.
   */
  it('saves when the field is left, not as it is typed', () => {
    expect(body).toContain('onBlur={() => void commit()}');
    expect(body).not.toContain('onChange={() => void commit()}');
  });

  it('says nothing to the server when nothing was changed', () => {
    expect(body).toContain('if (next === saved.current) return;');
  });

  it('puts what the assistant said in the field rather than in the database', () => {
    const describe_ = body.slice(body.indexOf('async function describe'));
    expect(describe_).toContain('setValue(result.alt)');
    expect(describe_).not.toContain('setMediaAltAction');
  });
});
