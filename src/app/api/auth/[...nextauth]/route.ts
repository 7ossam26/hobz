import { handlers } from '@/lib/auth/next-auth'

/**
 * Auth.js route handler. The only `/api` surface authentication needs — there
 * is no OAuth callback, no email verification link and no magic link, because
 * there is no email anywhere in this product (SPEC §2).
 */
export const { GET, POST } = handlers
