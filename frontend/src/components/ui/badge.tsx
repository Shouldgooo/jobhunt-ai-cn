import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-none border px-2 py-0.5 font-mono text-xs uppercase tracking-wider',
  {
    variants: {
      variant: {
        default:   'bg-black text-white border-black',
        secondary: 'bg-gray-200 text-black border-black',
        outline:   'bg-transparent text-black border-black',
        not_started:  'bg-gray-200 text-gray-800 border-gray-600',
        applied:      'bg-blue-700 text-white border-blue-700',
        followed_up:  'bg-yellow-400 text-black border-yellow-500',
        interviewed:  'bg-green-700 text-white border-green-700',
        rejected:     'bg-red-600 text-white border-red-600',
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
