import { toStorageString, type MoneyInput } from '@/lib/money'
import { resolveGraceHours as fallback } from '@/modules/lateness/service'

import { isPenaltyMode, type PenaltyMode } from './mode'

/**
 * modules/penalty/profile — SPEC §5.4's first line, and SPEC §5.3's grace chain.
 *
 * ```
 * profile = user.penaltyProfile ?? settings.defaultPenaltyProfile
 * ```
 *
 * `settings.defaultPenaltyProfile` is not a row. SPEC §7 puts "Penalty
 * defaults" in Settings and `penalty.defaultMode` / `defaultValue` /
 * `defaultGraceHours` have been there since Phase 0, so the Settings triple
 * *is* the default profile — see the note on `PenaltyProfile` in
 * `schema.prisma` for why a row flagged `isDefault` was not added beside it.
 *
 * Every value here is injected. Nothing in this file reads Settings or Prisma,
 * so the resolution order is provable without either (CLAUDE.md invariant 4).
 */

export interface PenaltyDefaults {
  mode: PenaltyMode
  /** Settings stores it as a number; it becomes a `Money` string on the way out. */
  value: number
  graceHours: number
}

/** Exactly the `PenaltyProfile` columns that decide a deduction. */
export interface PenaltyProfileValues {
  id: string
  name: string
  mode: PenaltyMode | string
  value: MoneyInput | { toFixed(dp: number): string }
  graceHours: number | null
}

export interface ResolvedPenaltyProfile {
  /** Null when the agency default applied — which the breakdown says out loud. */
  profileId: string | null
  profileName: string | null
  mode: PenaltyMode
  /** 2dp string: currency for `FIXED_*`, a percentage for `PCT_*`. */
  value: string
  /** The profile's own grace, or null to fall through. Not yet the final answer. */
  graceHours: number | null
}

const asMoneyInput = (value: PenaltyProfileValues['value']): MoneyInput =>
  typeof value === 'object' && value !== null && 'toFixed' in value
    ? (value as { toFixed(dp: number): string }).toFixed(2)
    : (value as MoneyInput)

/**
 * A profile is taken **whole or not at all**.
 *
 * Falling back per-field — this profile's mode with the agency's value — would
 * silently invent a formula nobody configured: a profile meaning "150 EGP once"
 * combined with a default meaning "5 percent per day" produces "150% of the
 * task value, per day". The mode is what gives `value` its unit, so the two
 * cannot be resolved independently.
 */
export function resolvePenaltyProfile(
  profile: PenaltyProfileValues | null | undefined,
  defaults: PenaltyDefaults,
): ResolvedPenaltyProfile {
  if (!profile) {
    return {
      profileId: null,
      profileName: null,
      mode: defaults.mode,
      value: toStorageString(defaults.value),
      graceHours: null,
    }
  }

  const mode = typeof profile.mode === 'string' ? profile.mode : String(profile.mode)
  if (!isPenaltyMode(mode)) {
    // Unreachable through Prisma — the column is an enum — but this function is
    // also the seam an import or a fixture reaches. Falling back to the default
    // mode would apply a formula nobody chose to somebody's money.
    throw new RangeError(`Unknown penalty mode: ${mode}`)
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    mode,
    value: toStorageString(asMoneyInput(profile.value)),
    graceHours: profile.graceHours,
  }
}

export interface GraceChain {
  /** `Project.gracePeriodHours` — the commitment made about *this work*. */
  projectOverride: number | null | undefined
  /** `PenaltyProfile.graceHours` — the commitment made to *this person*. */
  profileOverride: number | null | undefined
  /** Settings `penalty.defaultGraceHours`. */
  globalDefault: number
}

/**
 * SPEC §5.3 says "project override → global default"; SPEC R2 gives the
 * profile a grace of its own. Both are true at once as **project → profile →
 * global**, and the order is the one a disagreement should be settled in: the
 * project's grace is a promise made to a client about a specific piece of work,
 * which is narrower than a standing arrangement with a person. Where a project
 * has set one, SPEC §5.3 reads exactly as written.
 *
 * Built from `modules/lateness`'s two-argument resolver rather than
 * reimplementing it, so the `??`-never-`||` rule — a zero grace is a decision,
 * not a missing value — is stated once and applies to both links of the chain.
 */
export function resolveGraceHours(chain: GraceChain): number {
  return fallback(
    chain.projectOverride,
    fallback(chain.profileOverride, chain.globalDefault),
  )
}

/**
 * SPEC T4, with `Project.penalizeRevisionLateness` as the override Phase 3
 * already gave the column for.
 *
 * `??` matters more here than anywhere: this is a boolean, and `||` would make
 * a project that deliberately switched revision penalties **off** silently
 * inherit the agency's **on**.
 */
export function resolvePenalizeRevisionLateness(
  projectOverride: boolean | null | undefined,
  globalDefault: boolean,
): boolean {
  return projectOverride ?? globalDefault
}
