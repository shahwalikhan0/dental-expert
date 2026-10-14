import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        success:
          'border-transparent bg-green-100 text-green-800 hover:bg-green-100/80 dark:bg-green-950/40 dark:text-green-300',
        warning:
          'border-transparent bg-yellow-100 text-yellow-800 hover:bg-yellow-100/80 dark:bg-yellow-950/40 dark:text-yellow-300',
        info: 'border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100/80 dark:bg-blue-950/40 dark:text-blue-300',
        /*
         * The two below exist for the status tones in lib/status.ts.
         * `danger` is the soft red every status map was already hand-writing:
         * `destructive` is a solid fill, right for a button and too loud for
         * one cell in a column of soft badges, where "Overdue" would outshout
         * the row it belongs to. `purple` is money handed back — refunds.
         */
        danger:
          'border-transparent bg-red-100 text-red-800 hover:bg-red-100/80 dark:bg-red-950/40 dark:text-red-300',
        purple:
          'border-transparent bg-purple-100 text-purple-800 hover:bg-purple-100/80 dark:bg-purple-950/40 dark:text-purple-300',
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
