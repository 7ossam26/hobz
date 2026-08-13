import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui's class combiner. Tailwind-aware so later classes win properly. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
