import { ar } from '@/i18n/ar'

/**
 * The signed-out shell: one centred card and nothing else. No navigation,
 * because there is nowhere to go, and no marketing — SPEC §9 bans centred
 * marketing layouts *inside* the app, and this is the one screen where a
 * centred layout is the correct answer rather than a decorative one.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-lg font-semibold tracking-tight">{ar.app.name}</h1>
        <p className="text-muted-foreground text-sm">{ar.app.tagline}</p>
      </div>
      {children}
    </div>
  )
}
