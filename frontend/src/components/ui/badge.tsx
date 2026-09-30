import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 font-sans text-xs font-medium tracking-wide',
  {
    variants: {
      variant: {
        default:      'bg-[var(--primary-soft)] text-[var(--text-primary)] border-transparent',
        secondary:    'bg-[var(--sidebar)] text-[var(--text-secondary)] border-transparent',
        outline:      'bg-transparent text-[var(--text-primary)] border-[var(--border)]',
        not_started:  'bg-[var(--status-not-started-bg)] text-[var(--status-not-started-fg)] border-transparent',
        applied:      'bg-[var(--status-applied-bg)] text-[var(--status-applied-fg)] border-transparent',
        followed_up:  'bg-[var(--status-followed-bg)] text-[var(--status-followed-fg)] border-transparent',
        interviewed:  'bg-[var(--status-interview-bg)] text-[var(--status-interview-fg)] border-transparent',
        rejected:     'bg-[var(--status-rejected-bg)] text-[var(--status-rejected-fg)] border-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
