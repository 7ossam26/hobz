import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'

import { PreferencesProvider } from '@/components/layout/preferences-provider'
import { PwaProvider } from '@/components/layout/pwa-provider'
import { ToastProvider } from '@/components/shared/toast'
import { ar, DIRECTION } from '@/i18n/ar'
import { readPreferences } from '@/lib/preferences'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: ar.app.name,
    template: `%s · ${ar.app.name}`,
  },
  description: ar.app.description,
  // Internal tool: never index, never follow.
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  // iOS ignores the manifest's icon list and reads this one.
  appleWebApp: { capable: true, title: ar.app.shortName, statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

export const viewport: Viewport = {
  themeColor: [
    // `--surface-base` in each theme, kept in step with globals.css by
    // `tests/unit/design/palette-contrast.test.ts`.
    { media: '(prefers-color-scheme: light)', color: '#f6f7f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1111' },
  ],
}

/**
 * The document.
 *
 * Theme and density are read from cookies **here**, on the server, and written
 * straight onto `<html>`. That is the whole anti-flash strategy: the first byte
 * of HTML already carries `class="dark" data-density="compact"`, so there is no
 * inline script racing the paint and no `useEffect` correcting the page after
 * the user has seen it. `lib/preferences` explains why cookies rather than a
 * column on `User`.
 *
 * Reading cookies opts every route into dynamic rendering. Nothing here is
 * static anyway — every screen is behind a session (SPEC §2, invite-only, no
 * public surface).
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies()
  const preferences = readPreferences((name) => cookieStore.get(name)?.value)

  return (
    <html
      lang="ar"
      dir={DIRECTION}
      className={preferences.theme === 'dark' ? 'dark' : undefined}
      data-density={preferences.density}
      suppressHydrationWarning
    >
      <head>
        {/* The two faces above the fold. Preloading them avoids the layout
            shift that `font-display: swap` would otherwise cause on first paint. */}
        <link
          rel="preload"
          href="/fonts/ibm-plex-sans-arabic-arabic-400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/ibm-plex-sans-arabic-latin-400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-dvh">
        <PreferencesProvider initial={preferences}>
          <ToastProvider>{children}</ToastProvider>
          {/* Service-worker registration and the install bar. Renders nothing
              until the browser says the app is installable. */}
          <PwaProvider />
        </PreferencesProvider>
      </body>
    </html>
  )
}
