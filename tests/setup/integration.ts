import { afterAll, beforeEach } from 'vitest'

import '@/lib/zod-locale'

import { disconnectTestDb, resetDatabase } from './reset'

// Loaded after db-guard.ts, so by the time this runs the target database has
// already been proven to end in `_test`.
beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await disconnectTestDb()
})
