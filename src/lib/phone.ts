/**
 * lib/phone — Egyptian mobile numbers.
 *
 * The only consumer of a phone number in this product is the WhatsApp deep link
 * (SPEC §8): `https://wa.me/<digits>`. There is no SMS, no email and no
 * telephony API (CLAUDE.md invariant 9). That is precisely why this module
 * accepts **mobile numbers only** — a landline stored here would render a
 * WhatsApp button that silently goes nowhere, which is worse than a rejected
 * form field.
 *
 * Storage form is E.164 (`+201012345678`). Normalisation happens on write, in
 * the Zod schema, so no query ever has to guess which of the six spellings a
 * human typed.
 */

export const EGYPT_COUNTRY_CODE = '20'

/**
 * The four live Egyptian networks, as the first two digits of the national
 * significant number: Vodafone 10, Etisalat 11, Orange 12, WE 15.
 *
 * Adding a fifth operator is a one-line change here and nowhere else.
 */
export const EGYPT_MOBILE_PREFIXES = ['10', '11', '12', '15'] as const

/** `1X` operator pair + 8 subscriber digits. */
const NATIONAL_LENGTH = 10

const ARABIC_INDIC = /[٠-٩]/g
const EXTENDED_ARABIC_INDIC = /[۰-۹]/g

/**
 * Fold Arabic-Indic (٠١٢…) and Extended Arabic-Indic (۰۱۲…) digits to Western.
 *
 * Users type on Arabic keyboards. SPEC §2 mandates Western numerals for
 * *display*; this is the input side of the same decision. Skipping it turns
 * "the phone field rejects my number" into a permanent support ticket.
 */
export function foldArabicDigits(input: string): string {
  return input
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x06f0))
}

/**
 * Reduce any accepted spelling to the 10-digit national significant number, or
 * `null` if the input is not an Egyptian mobile.
 *
 * Accepted: `01012345678`, `+201012345678`, `00201012345678`, `201012345678`,
 * `1012345678` — each with or without spaces, dashes, dots or parentheses.
 *
 * Stripping the country code is unambiguous: an Egyptian national mobile number
 * always begins with `1`, never with `2`, so a leading `20` can only be the
 * country code.
 */
export function toNationalMobile(input: string): string | null {
  const folded = foldArabicDigits(input).trim()
  const hadPlus = folded.startsWith('+')

  let digits = folded.replace(/\D/g, '')
  if (digits.length === 0) return null

  // International prefixes, longest form first.
  if (digits.startsWith(`00${EGYPT_COUNTRY_CODE}`)) {
    digits = digits.slice(4)
  } else if (digits.startsWith(EGYPT_COUNTRY_CODE)) {
    // `+20…` is explicit. Bare `20…` is only the country code when the total
    // length says so — otherwise it is someone's subscriber digits.
    if (hadPlus || digits.length === EGYPT_COUNTRY_CODE.length + NATIONAL_LENGTH) {
      digits = digits.slice(2)
    }
  }

  // National trunk prefix.
  if (digits.startsWith('0')) digits = digits.slice(1)

  if (digits.length !== NATIONAL_LENGTH) return null

  const operator = digits.slice(0, 2)
  if (!(EGYPT_MOBILE_PREFIXES as readonly string[]).includes(operator)) return null

  return digits
}

/** E.164, the storage form: `+201012345678`. `null` when the input is not valid. */
export function normalizeEgyptMobile(input: string): string | null {
  const national = toNationalMobile(input)
  return national === null ? null : `+${EGYPT_COUNTRY_CODE}${national}`
}

export function isEgyptMobile(input: string): boolean {
  return toNationalMobile(input) !== null
}

/**
 * The `wa.me` path segment: digits only, no `+`. Phase 9 builds the full deep
 * link; this is the part that depends on how the number was stored.
 */
export function toWhatsappNumber(e164: string): string | null {
  const national = toNationalMobile(e164)
  return national === null ? null : `${EGYPT_COUNTRY_CODE}${national}`
}

/**
 * Display form: `+20 10 1234 5678`, grouped for scanning. Returns the input
 * unchanged when it cannot be parsed, so a legacy row still renders something.
 *
 * Rendered inside `dir="ltr"` at the component layer for the same reason money
 * is (CLAUDE.md) — a phone number reordered by bidi is a wrong number.
 */
export function formatMobileForDisplay(e164: string): string {
  const national = toNationalMobile(e164)
  if (national === null) return e164
  return `+${EGYPT_COUNTRY_CODE} ${national.slice(0, 2)} ${national.slice(2, 6)} ${national.slice(6)}`
}
