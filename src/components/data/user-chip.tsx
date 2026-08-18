import { MessageCircle } from 'lucide-react'
import * as React from 'react'

import { ar } from '@/i18n/ar'
import { hueForKey } from '@/lib/palette'
import { formatMobileForDisplay, toWhatsappNumber } from '@/lib/phone'
import { cn } from '@/lib/utils'

/**
 * A person, everywhere a person appears.
 *
 * ## The avatar
 *
 * Initials on a hue derived from the user id (`hueForKey`). No image, ever —
 * CLAUDE.md invariant 9 rules out file uploads and object storage, so there is
 * nowhere for a photo to live. That constraint turns out to be an advantage:
 * a stable colour per person is faster to recognise down a column of forty
 * rows than forty small photographs, and it never fails to load.
 *
 * ## The WhatsApp button
 *
 * SPEC §8: "every user card, task assignee chip and client record renders a
 * WhatsApp button". It is a plain `<a href="https://wa.me/…">` — no API, no
 * integration, no client JS. `rel="noreferrer"` because there is no reason for
 * WhatsApp to learn which internal screen the message was sent from.
 *
 * A user with no phone gets no button and a `title` saying why, rather than a
 * dead control.
 */

export interface UserChipUser {
  id: string
  fullName: string
  /** E.164, as stored. */
  phone?: string | null
  username?: string | null
  isActive?: boolean
}

/**
 * First letters of the first two words. Arabic has no case, so this is purely
 * a "which two glyphs identify this person" question, and the first letter of
 * the given and family name is the answer a reader already expects.
 */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0]!.slice(0, 2)
  return `${words[0]!.charAt(0)}${words[words.length - 1]!.charAt(0)}`
}

const AVATAR_SIZES = {
  sm: 'size-6 text-[0.625rem]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const

export function Avatar({
  user,
  size = 'md',
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  user: Pick<UserChipUser, 'id' | 'fullName'>
  size?: keyof typeof AVATAR_SIZES
}) {
  return (
    <span
      data-slot="avatar"
      data-hue={hueForKey(user.id)}
      aria-hidden
      className={cn(
        'bg-hue-surface text-hue-text inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        AVATAR_SIZES[size],
        className,
      )}
      {...props}
    >
      {initials(user.fullName)}
    </span>
  )
}

/**
 * The WhatsApp deep link (SPEC §8). `message` is a template already filled in
 * by the caller — the templates themselves are Settings values, and encoding
 * them is this function's only job.
 */
export function whatsappHref(phone: string, message?: string): string | null {
  const number = toWhatsappNumber(phone)
  if (!number) return null
  return message
    ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
    : `https://wa.me/${number}`
}

export function WhatsappButton({
  user,
  message,
  className,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href' | 'children'> & {
  user: Pick<UserChipUser, 'fullName' | 'phone'>
  message?: string
}) {
  const href = user.phone ? whatsappHref(user.phone, message) : null

  if (!href) {
    return (
      <span
        data-slot="whatsapp-disabled"
        title={ar.whatsapp.noPhone}
        aria-hidden
        className="text-fg-subtle inline-flex size-6 items-center justify-center opacity-40"
      >
        <MessageCircle className="size-3.5" />
      </span>
    )
  }

  const label = ar.whatsapp.openWith.replace('{name}', user.fullName)

  return (
    <a
      data-slot="whatsapp"
      data-hue="emerald"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
      className={cn(
        'text-fg-subtle hover:bg-hue-surface hover:text-hue-text inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <MessageCircle className="size-3.5" aria-hidden />
    </a>
  )
}

export function UserChip({
  user,
  size = 'md',
  showUsername = false,
  showWhatsapp = true,
  whatsappMessage,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  user: UserChipUser
  size?: keyof typeof AVATAR_SIZES
  showUsername?: boolean
  showWhatsapp?: boolean
  whatsappMessage?: string
}) {
  return (
    <span
      data-slot="user-chip"
      className={cn('inline-flex min-w-0 items-center gap-2', className)}
      {...props}
    >
      <Avatar user={user} size={size} />

      <span className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            'truncate font-medium',
            size === 'sm' ? 'text-xs' : 'text-sm',
            user.isActive === false && 'text-fg-muted line-through decoration-1',
          )}
        >
          {user.fullName}
        </span>
        {showUsername && user.username ? (
          <span className="text-fg-subtle truncate text-xs" dir="ltr">
            {user.username}
          </span>
        ) : null}
      </span>

      {showWhatsapp ? <WhatsappButton user={user} message={whatsappMessage} /> : null}
    </span>
  )
}

/** The phone number itself, when a screen shows contact details rather than a person. */
export function PhoneText({
  phone,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & {
  phone: string | null | undefined
}) {
  if (!phone)
    return <span className={cn('text-fg-subtle', className)}>{ar.common.none}</span>

  return (
    <span
      data-slot="phone"
      dir="ltr"
      className={cn('numeric-latn', className)}
      {...props}
    >
      {formatMobileForDisplay(phone)}
    </span>
  )
}
