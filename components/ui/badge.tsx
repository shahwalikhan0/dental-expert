import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        // An edge as well as a fill, so a neutral badge is visible on a white card.
        secondary: 'border-border bg-muted text-foreground/80 hover:bg-muted/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'border-input bg-card text-foreground',
        success:
          'border-green-600/20 bg-green-50 text-green-800 hover:bg-green-50/80 dark:border-green-400/20 dark:bg-green-950/40 dark:text-green-300',
        warning:
          'border-amber-600/25 bg-amber-50 text-amber-800 hover:bg-amber-50/80 dark:border-amber-400/20 dark:bg-amber-950/40 dark:text-amber-300',
        info: 'border-blue-600/20 bg-blue-50 text-blue-800 hover:bg-blue-50/80 dark:border-blue-400/20 dark:bg-blue-950/40 dark:text-blue-300',
        /*
         * The two below exist for the status tones in lib/status.ts.
         * `danger` is the soft red every status map was already hand-writing:
         * `destructive` is a solid fill, right for a button and too loud for
         * one cell in a column of soft badges, where "Overdue" would outshout
         * the row it belongs to. `purple` is money handed back — refunds.
         */
        danger:
          'border-red-600/20 bg-red-50 text-red-800 hover:bg-red-50/80 dark:border-red-400/20 dark:bg-red-950/40 dark:text-red-300',
        purple:
          'border-purple-600/20 bg-purple-50 text-purple-800 hover:bg-purple-50/80 dark:border-purple-400/20 dark:bg-purple-950/40 dark:text-purple-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
