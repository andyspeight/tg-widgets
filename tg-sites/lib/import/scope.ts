/**
 * The class that confines one import.
 *
 * ON ITS OWN, AWAY FROM THE STYLESHEET TOOLS, and the separation is the point.
 * This is a dozen characters of string work, but it used to live in
 * lib/import/css.ts beside scopeImportCss, so the renderer could not write the
 * wrapper's class without importing postcss. The block that wears the class runs
 * in the browser; the tool that scopes the stylesheet to it does not. Splitting
 * them is what lets the first happen without the second. See task #94.
 *
 * ONE PLACE STILL DECIDES IT, which was always the reason this function exists:
 * the block that writes this class onto its wrapper and the stylesheet that
 * depends on it being there have to agree, and a rendered section whose CSS is
 * scoped to a class it does not carry is an unstyled section with no error
 * anywhere. Moving it has not split that decision in two, it has only put the
 * one decision somewhere both sides can reach.
 */
export function importScopeClass(id: string): string {
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return `tgi-${safe || 'x'}`;
}
