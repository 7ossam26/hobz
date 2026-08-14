import type { DefaultSession } from 'next-auth'

/**
 * Auth.js module augmentation.
 *
 * The JWT is the edge-visible identity: `src/middleware.ts` reads it to decide
 * whether a route may render, and the navigation reads it to decide which links
 * to draw. Everything that can read or write data re-resolves from the database
 * first (`lib/auth/resolve`) — see the note there on why.
 */

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      username: string
      isSuperAdmin: boolean
      permissions: string[]
      mustChangePassword: boolean
    } & DefaultSession['user']

    /** Present only while a SUPER_ADMIN is viewing the app as someone else. */
    impersonator?: {
      id: string
      fullName: string
    }
  }

  interface User {
    id?: string
    username: string
    fullName: string
    isSuperAdmin: boolean
    permissions: string[]
    mustChangePassword: boolean
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid: string
    username: string
    fullName: string
    isSuperAdmin: boolean
    permissions: string[]
    mustChangePassword: boolean
    /** The real SUPER_ADMIN while `uid` is the impersonated user. */
    impersonatorId?: string
    impersonatorName?: string
  }
}

export {}
