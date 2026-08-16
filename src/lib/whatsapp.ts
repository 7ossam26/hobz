/**
 * lib/whatsapp — filling the Settings-configured WhatsApp templates (SPEC §8)
 * with the four variables the phase brief names: `{name}`, `{task}`,
 * `{due}`, `{amount}`.
 *
 * Pure and framework-free so it is safe to import from a client component —
 * the templates themselves are fetched server-side (`getSetting('whatsapp.
 * templates')`, CLAUDE.md invariant 4) and passed down as plain strings; this
 * is only the `{placeholder}` substitution, the same `.replace()` chain every
 * other Arabic template in the codebase uses (`modules/penalty/breakdown.ts`,
 * `modules/notification/messages.ts`).
 */

export interface WhatsappTemplateVars {
  name?: string
  task?: string
  due?: string
  amount?: string
}

export function fillWhatsappTemplate(
  template: string,
  vars: WhatsappTemplateVars,
): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) continue
    result = result.replaceAll(`{${key}}`, value)
  }
  return result
}
