import type { MetadataRoute } from 'next'

import { ar } from '@/i18n/ar'

/**
 * The web app manifest (SPEC/phase brief: "installable PWA").
 *
 * A metadata route rather than a static `public/manifest.json`, so the Arabic
 * name and description come from `src/i18n/ar.ts` like every other string in
 * the product — CLAUDE.md's "no Arabic string literals" applies to the install
 * dialog as much as to a button.
 *
 * `start_url` is `/dashboard`, not `/`: the root immediately redirects there
 * for a signed-in user, and an installed icon that opens on a redirect costs a
 * visible flash every launch. A signed-out launch still lands on `/login` via
 * the middleware, which is correct.
 *
 * No `share_target`, no `shortcuts` to write actions, no offline data sync
 * (phase brief). Installability here buys a real window and a home-screen
 * icon on a manager's phone; it is not an attempt to become an offline app on
 * top of a database this product cannot reach from a browser.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ar.app.name,
    short_name: ar.app.shortName,
    description: ar.app.description,
    lang: 'ar',
    dir: 'rtl',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    // Matches the light `--surface` in globals.css; the dark equivalent is
    // handled by `themeColor` in the root layout's viewport export, which the
    // browser prefers when it has one.
    background_color: '#f8f8f9',
    theme_color: '#7c3aed',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
