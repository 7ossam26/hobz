import '@testing-library/jest-dom/vitest'
import '@/lib/zod-locale'

/**
 * Unit-project setup.
 *
 * The whole product runs in Africa/Cairo (SPEC §2). Pinning the runner's zone
 * here means a developer in another timezone gets the same results as CI —
 * without it, "is this deadline late?" would be machine-dependent.
 */
process.env.TZ = 'Africa/Cairo'
