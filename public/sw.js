 
/**
 * public/sw.js — the offline *shell*, and deliberately nothing more.
 *
 * ── What this caches, and what it must never cache ─────────────────────────
 *
 * Every page in this product is behind a session and is rendered per user
 * (SPEC §2: invite-only, no public surface). A service worker that cached HTML
 * responses would be a cache of one user's payouts, served to whoever opens
 * the browser next — including after they sign out. So:
 *
 *   - **Static assets only.** `/_next/static/*` and `/fonts/*` are
 *     content-hashed or immutable, carry no session, and are the entire reason
 *     a second launch feels instant.
 *   - **Navigations are network-only**, with the pre-cached `/offline` page as
 *     the fallback when the network is gone. Never a cached dashboard.
 *   - **Nothing else is touched.** Server actions, API routes, `/api/auth` and
 *     every POST go straight to the network, uncached, always.
 *
 * The phase brief says "no offline data sync", and this is what enforcing that
 * looks like: there is no queue, no IndexedDB, no background sync. Offline you
 * get the shell and an honest Arabic message.
 *
 * ── Versioning ─────────────────────────────────────────────────────────────
 *
 * `CACHE_VERSION` is bumped by hand when this file's *strategy* changes. Asset
 * URLs are content-hashed by Next, so a deploy naturally writes new entries;
 * `activate` deletes every cache that is not the current one, which is what
 * stops an old deploy's chunks accumulating forever.
 */

const CACHE_VERSION = 'agency-os-v1'
const OFFLINE_URL = '/offline'

/** Pre-cached at install: the fallback page and the two faces above the fold. */
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/fonts/ibm-plex-sans-arabic-arabic-400.woff2',
  '/fonts/ibm-plex-sans-arabic-latin-400.woff2',
  '/icons/icon-192.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION)
      // `reload` bypasses the HTTP cache: installing a new worker must fetch
      // the current offline page, not whatever the browser kept from before.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' })
            if (response.ok) await cache.put(url, response)
          } catch {
            // One unreachable asset must not fail the whole install; the worker
            // is still useful for everything that did land.
          }
        }),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/** Content-hashed or immutable, and never user-specific. */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icons/')
  )
}

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Anything that changes state, or is not ours, is the network's business.
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (isCacheableAsset(url)) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkThenOfflinePage(request))
  }

  // Everything else — server actions, `/api/*`, RSC payloads — falls through
  // untouched, which is the only correct answer for authenticated data.
})

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  // Opaque and error responses are not worth keeping; a cached 404 for a chunk
  // would survive the deploy that fixed it.
  if (response.ok && response.type === 'basic') {
    cache.put(request, response.clone())
  }
  return response
}

async function networkThenOfflinePage(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(CACHE_VERSION)
    const offline = await cache.match(OFFLINE_URL)
    if (offline) return offline
    return new Response('', { status: 503, statusText: 'Offline' })
  }
}
