import { Loader2 } from 'lucide-react'
import type React from 'react'

export interface SwitchProps {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  loading?: boolean
  size?: 'sm' | 'md'
  label?: string
  className?: string
}

export const Switch: React.FC<SwitchProps> = ({
  id,
  checked,
  onChange,
  disabled = false,
  loading = false,
  size = 'md',
  label,
  className = '',
}) => {
  const isSm = size === 'sm'

  return (
    <label
      htmlFor={id}
      className={`inline-flex items-center gap-2 select-none cursor-pointer ${
        disabled || loading ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      <div className="relative inline-flex items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            if (!disabled && !loading) {
              onChange(e.target.checked)
            }
          }}
          disabled={disabled || loading}
          className="sr-only peer"
        />
        <div
          className={`rounded-full transition-colors ${
            isSm ? 'w-7 h-4' : 'w-9 h-5'
          } ${
            checked
              ? 'bg-primary'
              : 'bg-muted-foreground/30 peer-hover:bg-muted-foreground/40'
          }`}
        />
        <div
          className={`absolute rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${
            isSm ? 'w-3 h-3 left-0.5' : 'w-4 h-4 left-0.5'
          } ${
            checked
              ? isSm
                ? 'translate-x-3'
                : 'translate-x-4'
              : 'translate-x-0'
          }`}
        >
          {loading && (
            <Loader2
              className={`animate-spin text-primary ${
                isSm ? 'w-2 h-2' : 'w-2.5 h-2.5'
              }`}
            />
          )}
        </div>
      </div>
      {label && <span className="text-xs text-foreground">{label}</span>}
    </label>
  )
}
