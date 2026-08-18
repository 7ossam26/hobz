/**
 * lib/security-headers — the response headers every request carries.
 *
 * Split into two groups because they are applied in two places, and the split
 * is not arbitrary:
 *
 *  - **`STATIC_SECURITY_HEADERS`** are the same on every response, so they are
 *    set once in `next.config.ts` and therefore also cover the paths the
 *    middleware deliberately does not match (`/_next/static`, fonts, icons,
 *    `sw.js`).
 *  - **The CSP** carries a per-request nonce, so it can only be built in the
 *    middleware. Next.js reads the nonce back out of the *request* copy of the
 *    header and stamps it onto its own bootstrap scripts.
 *
 * This is an internal, invite-only tool with no third-party scripts, no
 * analytics, no CDN and no embeds (CLAUDE.md invariant 9), which is what makes
 * a genuinely strict policy affordable here — there is nothing to allowlist.
 */

/** Set in `next.config.ts`, so they reach static assets too. */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // MIME sniffing turns an uploaded-looking response into a script. There are
  // no uploads here (invariant 9), and the header still costs nothing.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Belt and braces with CSP's `frame-ancestors`, for browsers that honour only
  // one of the two.
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    // The app has no outbound links to speak of, but a path like
    // `/projects/<id>` in a Referer is a leak of internal structure.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Nothing in this product uses a device API. Denying them all means a
    // future dependency cannot quietly start.
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'camera=()',
      'display-capture=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
    ].join(', '),
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    /**
     * Two years, subdomains included. Only meaningful over HTTPS, which is what
     * Dokploy's proxy terminates; a browser ignores it on plain HTTP, so this
     * is safe on a local `http://localhost:3000` too.
     *
     * `preload` is deliberately **not** set: submitting a domain to the preload
     * list is close to irreversible, and that is the deployer's decision to
     * make, not this file's. See docs/RUNBOOK.md.
     */
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
]

/**
 * The per-request CSP.
 *
 * `'strict-dynamic'` is what makes the nonce worth having: Next's bootstrap
 * script is trusted by nonce, and the chunks *it* loads inherit that trust, so
 * no chunk URL ever needs allowlisting. Browsers that do not understand
 * `strict-dynamic` fall back to `'self'`, which is still correct here.
 *
 * Two relaxations, both named rather than hidden:
 *
 *  - **`style-src 'unsafe-inline'`.** React writes inline `style` attributes,
 *    and Next injects a small inline stylesheet. There is no nonce path for
 *    either. The exposure is CSS injection, not script execution.
 *  - **`'unsafe-eval'` in development only.** React Refresh needs it. It is
 *    absent from production, which is the build that faces a network.
 */
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives: Array<[string, string]> = [
    ['default-src', "'self'"],
    [
      'script-src',
      `'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    ],
    ['style-src', "'self' 'unsafe-inline'"],
    // `data:` covers the generated icons and any inline SVG data URI; blob: is
    // what `.xlsx` export uses to hand a file to the browser (SPEC §10).
    ['img-src', "'self' data: blob:"],
    ['font-src', "'self'"],
    // Same-origin only: no telemetry endpoint, no external API (invariant 9).
    ['connect-src', "'self'"],
    ['worker-src', "'self' blob:"],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['frame-src', "'none'"],
  ]

  /**
   * `upgrade-insecure-requests` is deliberately absent.
   *
   * It rewrites every `http://` request the document makes to `https://` —
   * including the RSC payload fetches and server-action POSTs the App Router
   * lives on. Against any origin served over plain HTTP that is a TLS handshake
   * against a server that speaks none, so the request fails with
   * `ERR_SSL_PROTOCOL_ERROR` and the action silently never runs. Phase 12 found
   * it the hard way: `tests/e2e/flow-2` clicked "اعتماد المهمة", the dialog
   * closed, and the task stayed IN_REVIEW with no error anywhere.
   *
   * The concern it addresses is covered better by the two things that remain:
   * `Strict-Transport-Security` (which upgrades at the *browser* level, for the
   * real domain, and cannot break a local HTTP origin) and terminating TLS at
   * the proxy so there is no mixed content to upgrade in the first place.
   */

  return directives.map(([name, value]) => (value ? `${name} ${value}` : name)).join('; ')
}

/** 128 bits of CSPRNG, base64 — the shape the CSP spec asks for. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
