import { Loader2 } from 'lucide-react'
import type React from 'react'

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  loading?: boolean
  icon?: React.ReactNode
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-lg whitespace-nowrap shrink-0 min-w-fit transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 select-none disabled:opacity-50 disabled:pointer-events-none'

  const variantStyles = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
    secondary:
      'bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
    danger:
      'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
    ghost:
      'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
    outline:
      'border border-border bg-background text-foreground hover:bg-accent',
  }

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-xs px-3.5 py-2 gap-2',
    lg: 'text-sm px-4 py-2.5 gap-2.5',
    icon: 'p-2 rounded-md',
  }

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}
