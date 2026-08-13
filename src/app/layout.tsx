import type { Metadata, Viewport } from 'next'

import { ar, DIRECTION } from '@/i18n/ar'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: ar.app.name,
    template: `%s · ${ar.app.name}`,
  },
  description: ar.app.description,
  // Internal tool: never index, never follow.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#18181b' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir={DIRECTION} suppressHydrationWarning>
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
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
