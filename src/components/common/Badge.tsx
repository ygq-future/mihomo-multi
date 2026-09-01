import type React from 'react'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | 'default'
    | 'secondary'
    | 'primary'
    | 'success'
    | 'warning'
    | 'danger'
    | 'outline'
  size?: 'sm' | 'md'
  dot?: boolean
  dotColor?: string
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  dotColor,
  className = '',
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center font-medium rounded border select-none transition-colors'

  const sizeStyles = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2 py-0.5 gap-1.5',
  }

  const variantStyles = {
    default: 'bg-secondary text-muted-foreground border-border',
    secondary: 'bg-secondary/80 text-secondary-foreground border-border/60',
    primary: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    outline: 'bg-transparent text-foreground border-border',
  }

  return (
    <span
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            dotColor ||
            (variant === 'success'
              ? 'bg-emerald-500'
              : variant === 'warning'
                ? 'bg-amber-500'
                : variant === 'danger'
                  ? 'bg-rose-500'
                  : 'bg-primary')
          }`}
        />
      )}
      {children}
    </span>
  )
}
