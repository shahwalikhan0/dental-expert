'use client'

import { Printer } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import type { PrintHandle } from '@/hooks/use-print'

/**
 * The Print button. Disabled until the clinic's print layout has loaded, so
 * the first click cannot print without the letterhead space.
 */
export function PrintButton({
  printing,
  label = 'Print',
  variant = 'outline',
  size,
  className,
}: {
  printing: PrintHandle
  label?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  className?: string
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={printing.print}
      disabled={!printing.ready}
    >
      <Printer className="mr-2 h-4 w-4" />
      {label}
    </Button>
  )
}
