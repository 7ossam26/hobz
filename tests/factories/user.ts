import { ARABIC_FULL_NAMES, EGYPT_PHONES } from '../fixtures/arabic-names'

/**
 * Factories — docs/TESTING.md §5: "Use factories; never hand-build a 20-field
 * object inline."
 *
 * Two levels, deliberately:
 *   buildX()  → a plain object, no database. For unit tests.
 *   createX() → persists via an injected client. Added per phase as the
 *               integration suites need them.
 *
 * Counters make usernames unique within a run; the DB reset makes them unique
 * across runs.
 */

let seq = 0
const nextSeq = (): number => (seq += 1)

/** Reset between test files that assert on generated identifiers. */
export function resetFactorySequence(): void {
  seq = 0
}

export type PayType = 'SALARY' | 'PER_TASK' | 'HYBRID'

export interface BuiltUser {
  id: string
  username: string
  usernameCanonical: string
  passwordHash: string
  fullName: string
  phone: string | null
  isWorker: boolean
  isActive: boolean
  mustChangePassword: boolean
  timezone: string
  payType: PayType
  monthlySalary: string | null
  defaultTaskRate: string | null
  weeklyCapacityHours: number
  penaltyProfileId: string | null
  deletedAt: Date | null
}

export function buildUser(overrides: Partial<BuiltUser> = {}): BuiltUser {
  const n = nextSeq()
  const name = ARABIC_FULL_NAMES[n % ARABIC_FULL_NAMES.length] ?? ARABIC_FULL_NAMES[0]
  const phone = EGYPT_PHONES[n % EGYPT_PHONES.length] ?? EGYPT_PHONES[0]

  return {
    id: `user_${n}`,
    username: `user${n}`,
    usernameCanonical: `user${n}`,
    // Never a real hash: unit tests must not pay bcrypt's cost-12 price.
    passwordHash: `hashed:password${n}`,
    fullName: name,
    phone: phone.e164,
    isWorker: true,
    isActive: true,
    mustChangePassword: false,
    timezone: 'Africa/Cairo',
    payType: 'PER_TASK',
    monthlySalary: null,
    defaultTaskRate: '500.00',
    weeklyCapacityHours: 40,
    penaltyProfileId: null,
    deletedAt: null,
    ...overrides,
  }
}

/** A salaried worker — the shape `dailyRate()` needs in the penalty suites. */
export function buildSalariedUser(overrides: Partial<BuiltUser> = {}): BuiltUser {
  return buildUser({
    payType: 'SALARY',
    monthlySalary: '11000.00',
    defaultTaskRate: null,
    ...overrides,
  })
}

export function buildHybridUser(overrides: Partial<BuiltUser> = {}): BuiltUser {
  return buildUser({
    payType: 'HYBRID',
    monthlySalary: '8000.00',
    defaultTaskRate: '300.00',
    ...overrides,
  })
}
