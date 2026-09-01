import { X } from 'lucide-react'
import type React from 'react'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  prefixIcon?: React.ReactNode
  suffixIcon?: React.ReactNode
  clearable?: boolean
  onClear?: () => void
  required?: boolean
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  prefixIcon,
  suffixIcon,
  clearable = false,
  onClear,
  required,
  className = '',
  id,
  value,
  ...props
}) => {
  const showClear = clearable && Boolean(value) && onClear

  return (
    <div className="space-y-1.5 w-full">
      {label && (
        <label
          htmlFor={id}
          className="text-xs font-medium text-foreground flex items-center gap-1"
        >
          <span>{label}</span>
          {required && <span className="text-destructive">*</span>}
        </label>
      )}

      <div className="relative flex items-center">
        {prefixIcon && (
          <div className="absolute left-3 text-muted-foreground pointer-events-none">
            {prefixIcon}
          </div>
        )}

        <input
          id={id}
          value={value}
          className={`w-full py-2 rounded-lg bg-background border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all disabled:opacity-50 ${
            prefixIcon ? 'pl-9' : 'pl-3'
          } ${suffixIcon || showClear ? 'pr-9' : 'pr-3'} ${
            error
              ? 'border-destructive focus:ring-destructive'
              : 'border-border'
          } ${className}`}
          {...props}
        />

        {showClear ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2.5 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          suffixIcon && (
            <div className="absolute right-3 text-muted-foreground">
              {suffixIcon}
            </div>
          )
        )}
      </div>

      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : (
        helperText && (
          <p className="text-[11px] text-muted-foreground">{helperText}</p>
        )
      )}
    </div>
  )
}
