/**
 * modules/task/mentions.ts — `@username` parsing for task comments (SPEC §4:
 * `TaskComment … mentions[]`).
 *
 * Handles are matched, not names: `lib/auth/username` fixes usernames to latin
 * lowercase for exactly this class of reason (they appear in audit rows and log
 * lines where bidi-reordered Arabic is ambiguous), and a comment body is
 * overwhelmingly Arabic text. A latin handle inside Arabic prose is
 * unambiguous to find; an Arabic display name is not.
 *
 * What is parsed here is only half the job — the service resolves each handle
 * to a user id and stores *ids* in `mentions[]`. See `service.addComment`.
 */

/**
 * Mirrors `USERNAME_RE` in `lib/auth/username`: latin lowercase, digits, and
 * `. _ -` between them but never at either end. Trailing punctuation therefore
 * falls outside the capture on its own — `مرحبًا @ahmed.` yields `ahmed`.
 *
 * The leading `(?:^|[^a-z0-9._-])` is what stops an email-looking string or a
 * mid-word `@` from registering as a mention.
 */
const MENTION_RE = /(?:^|[^a-zA-Z0-9._-])@([a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?)/g

/**
 * Every distinct handle mentioned, normalised and in first-appearance order.
 *
 * Order is stable rather than incidental so that a stored `mentions[]` array
 * compares equal across re-parses, and duplicates collapse — mentioning someone
 * three times in one comment is one mention.
 */
export function parseMentions(body: string): string[] {
  const handles: string[] = []
  const seen = new Set<string>()

  for (const match of body.matchAll(MENTION_RE)) {
    const handle = match[1]?.toLowerCase()
    if (!handle || seen.has(handle)) continue
    seen.add(handle)
    handles.push(handle)
  }

  return handles
}
