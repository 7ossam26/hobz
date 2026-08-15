'use client'

import * as React from 'react'

import { RelativeTime } from '@/components/data/relative-time'
import { Avatar } from '@/components/data/user-chip'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import { cn } from '@/lib/utils'
import { addTaskCommentAction } from '@/modules/task/actions'
import type { TaskCommentDto } from '@/modules/task/types'
import type { UserOptionDto } from '@/modules/user/queries'

import type { TaskPermissions } from '../tasks-client'

/** Same shape as `modules/task/mentions.ts`'s `MENTION_RE`, for *display* only. */
const MENTION_DISPLAY_RE = /@([a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?)/g

function renderBody(body: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const match of body.matchAll(MENTION_DISPLAY_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push(body.slice(lastIndex, index))
    parts.push(
      <span key={key++} className="text-accent-solid font-medium">
        {match[0]}
      </span>,
    )
    lastIndex = index + match[0].length
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex))
  return parts
}

/** `@handle` under the caret, if the caret sits right after one being typed. */
function activeMention(
  value: string,
  cursor: number,
): { query: string; start: number } | null {
  const upToCursor = value.slice(0, cursor)
  const match = /(?:^|[^a-zA-Z0-9._-])@([a-zA-Z0-9._-]*)$/.exec(upToCursor)
  if (!match) return null
  const query = match[1] ?? ''
  return { query: query.toLowerCase(), start: cursor - query.length }
}

export function TaskCommentsTab({
  taskId,
  comments,
  userOptions,
  permissions,
  onMutated,
}: {
  taskId: string
  comments: TaskCommentDto[]
  userOptions: UserOptionDto[]
  permissions: TaskPermissions
  onMutated: () => void
}) {
  const { toast } = useToast()
  const [body, setBody] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [mention, setMention] = React.useState<{ query: string; start: number } | null>(
    null,
  )
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const suggestions = mention
    ? userOptions
        .filter((user) => user.username.toLowerCase().startsWith(mention.query))
        .slice(0, 5)
    : []

  function onChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value
    setBody(value)
    setMention(activeMention(value, event.target.selectionStart ?? value.length))
  }

  function pick(username: string) {
    if (!mention) return
    const before = body.slice(0, mention.start)
    const after = body.slice(mention.start + mention.query.length)
    const next = `${before}${username} ${after}`
    setBody(next)
    setMention(null)
    textareaRef.current?.focus()
  }

  async function submit() {
    const trimmed = body.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await addTaskCommentAction({ taskId, body: trimmed })
      setBody('')
      setMention(null)
      onMutated()
    } catch {
      toast({ title: ar.errors.unexpected, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {comments.length === 0 ? (
          <p className="text-fg-subtle text-sm">{ar.tasks.comments.empty}</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-2.5">
              <Avatar user={comment.author} size="sm" />
              <div className="bg-surface-sunken min-w-0 flex-1 rounded-lg border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{comment.author.fullName}</span>
                  <RelativeTime
                    value={comment.createdAt}
                    className="text-fg-subtle text-xs"
                  />
                </div>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                  {renderBody(comment.body)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {permissions.canComment ? (
        <div className="relative flex flex-col gap-2 border-t pt-3">
          <Textarea
            ref={textareaRef}
            rows={3}
            value={body}
            placeholder={ar.tasks.comments.placeholder}
            onChange={onChange}
            onBlur={() => setTimeout(() => setMention(null), 150)}
          />

          {mention && suggestions.length > 0 ? (
            <div className="bg-popover shadow-overlay absolute bottom-full z-10 mb-1 w-56 rounded-lg border p-1">
              {suggestions.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(user.username)}
                  className={cn(
                    'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors',
                  )}
                >
                  <Avatar user={user} size="sm" />
                  <span className="truncate">{user.fullName}</span>
                  <span className="text-fg-subtle ms-auto text-xs" dir="ltr">
                    @{user.username}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <p className="text-fg-subtle text-xs">{ar.tasks.comments.mentionHint}</p>
          <Button
            type="button"
            size="sm"
            className="self-end"
            disabled={!body.trim() || busy}
            onClick={submit}
          >
            {ar.tasks.comments.submit}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
