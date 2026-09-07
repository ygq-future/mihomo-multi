import { Loader2, X } from 'lucide-react'
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
  loading?: boolean
  integerOnly?: boolean
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
  loading = false,
  className = '',
  id,
  value,
  disabled,
  onFocus,
  integerOnly = false,
  onKeyDown,
  onChange,
  inputMode,
  ...props
}) => {
  const showClear = clearable && Boolean(value) && onClear && !loading

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Automatically move cursor to the end of text on focus
    const val = e.currentTarget.value
    if (typeof val === 'string' || typeof val === 'number') {
      try {
        const len = String(val).length
        e.currentTarget.setSelectionRange(len, len)
      } catch {
        // Some browsers throw InvalidStateError for setSelectionRange on input[type="number"]
      }
    }
    onFocus?.(e)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (integerOnly) {
      // Disallow decimal point, exponent e/E, and signs +/-
      if (
        e.key === '.' ||
        e.key === 'e' ||
        e.key === 'E' ||
        e.key === '+' ||
        e.key === '-' ||
        e.key === ','
      ) {
        e.preventDefault()
        return
      }
    }
    onKeyDown?.(e)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (integerOnly) {
      const rawValue = e.target.value
      const cleanedValue = rawValue.replace(/\D/g, '')
      if (rawValue !== cleanedValue) {
        e.target.value = cleanedValue
      }
    }
    onChange?.(e)
  }

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
          disabled={disabled || loading}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          inputMode={inputMode ?? (integerOnly ? 'numeric' : undefined)}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`w-full py-2 rounded-lg bg-background border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors duration-150 disabled:opacity-50 ${
            prefixIcon ? 'pl-9' : 'pl-3'
          } ${suffixIcon || showClear || loading ? 'pr-8' : 'pr-3'} ${
            error
              ? 'border-destructive focus:border-destructive focus:ring-2 focus:ring-destructive/20'
              : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/20'
          } ${className}`}
          {...props}
        />

        {loading ? (
          <div className="absolute right-2.5 text-muted-foreground pointer-events-none">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          </div>
        ) : showClear ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2.5 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          suffixIcon && (
            <div className="absolute right-3 text-muted-foreground pointer-events-none">
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
