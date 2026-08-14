/**
 * lib/auth/ip — the client address, for throttle keys and audit rows.
 *
 * The app sits behind Dokploy's reverse proxy, so the socket address is always
 * the proxy. `x-forwarded-for` is a list appended to by each hop, and the
 * *first* entry is the original client — the later ones are the proxies.
 *
 * A caveat worth stating plainly, because it decides how much this value is
 * worth: `x-forwarded-for` is a header, and headers can be forged. Everything
 * here is therefore best-effort. The throttle is keyed on the **username as
 * well as** the IP for exactly this reason (see rate-limit.ts) — spoofing the
 * header rotates one of the two keys, not both.
 */

const FORWARDED_FOR = 'x-forwarded-for'
const REAL_IP = 'x-real-ip'

/** IPv6 loses its zone id and brackets; IPv4-mapped forms are unwrapped. */
function normalizeIp(raw: string): string | undefined {
  const value = raw.trim().replace(/^\[|\]$/g, '').split('%')[0]
  if (!value) return undefined
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value)
  return mapped?.[1] ?? value
}

export function clientIpFromHeaders(headers: Headers): string | undefined {
  const forwarded = headers.get(FORWARDED_FOR)
  if (forwarded) {
    const first = forwarded.split(',')[0]
    if (first) {
      const ip = normalizeIp(first)
      if (ip) return ip
    }
  }

  const real = headers.get(REAL_IP)
  return real ? normalizeIp(real) : undefined
}
