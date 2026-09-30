import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-sans text-sm font-medium tracking-wide transition-colors disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default:     'bg-[var(--primary-dark)] text-[var(--surface)] hover:bg-[var(--primary)]',
        destructive: 'bg-[var(--primary-dark)] text-[var(--surface)] hover:bg-[var(--primary)]',
        success:     'bg-[var(--primary-dark)] text-[var(--surface)] hover:bg-[var(--primary)]',
        outline:     'bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--primary-soft)]',
        secondary:   'bg-[var(--primary-soft)] text-[var(--text-primary)] hover:bg-[var(--secondary)]',
        ghost:       'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--primary-soft)] hover:text-[var(--text-primary)]',
        link:        'text-[var(--primary-dark)] underline-offset-4 hover:underline border-0 shadow-none',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm:      'h-8 px-3 text-xs',
        lg:      'h-10 px-5',
        icon:    'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
