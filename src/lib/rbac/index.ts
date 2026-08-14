/**
 * lib/rbac — the access-control surface.
 *
 *   catalog.ts  the permission keys (SPEC §6) and the reserved SUPER_ADMIN role
 *   actor.ts    the Actor shape, `can()` / `assertCan()`
 *   scope.ts    `view.all` vs `view.assigned` as Prisma where-fragments
 *   require.ts  the server-action wrapper, bound to a session in lib/auth
 *
 * Nothing here imports `lib/auth`, `next/*` or Prisma. That is what lets the
 * whole module — including the wrapper that guards every write path — be unit
 * tested without a database or a request.
 */

export * from './catalog'
export * from './actor'
export * from './scope'
export * from './require'
