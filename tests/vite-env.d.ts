/**
 * `import.meta.glob` — Vite's compile-time directory import, used by
 * `tests/integration/rbac/every-action-is-gated.test.ts` to find every module's
 * `actions.ts` without a hand-maintained list.
 *
 * Declared here rather than by referencing `vite/client`, for two reasons:
 * `vite` is not a direct dependency of this project (it arrives under Vitest,
 * so the reference does not resolve from the project root), and `vite/client`
 * would also pull the browser asset-import globals into scope for every file
 * TypeScript checks — including the server modules that must never see them.
 *
 * The call itself has to be written literally. Vite rewrites it at build time,
 * so assigning `import.meta.glob` to a variable first leaves a runtime property
 * access that does not exist.
 */
interface ImportMeta {
  glob: (pattern: string) => Record<string, () => Promise<Record<string, unknown>>>
}
