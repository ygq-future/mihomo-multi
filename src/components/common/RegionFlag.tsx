import type React from 'react'

export interface RegionFlagProps {
  code: string
  className?: string
  size?: 'sm' | 'md'
}

export const RegionFlag: React.FC<RegionFlagProps> = ({
  code,
  className = '',
  size = 'md',
}) => {
  const norm = code.toUpperCase().trim()
  const dim = size === 'sm' ? 'w-3.5 h-2.5' : 'w-4 h-3'

  const renderSvg = () => {
    switch (norm) {
      case 'HK':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#e1261a" d="M0 0h640v480H0z" />
            <path
              fill="#fff"
              d="M320 240l-20-40 30 10-10-30 35 25 15-30 10 35 40-10-25 35 30 15-35 10 10 30-35-25-15 30-10-35-40 10 25-35-30-15z"
            />
          </svg>
        )
      case 'JP':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#fff" d="M0 0h640v480H0z" />
            <circle cx="320" cy="240" r="120" fill="#bc002d" />
          </svg>
        )
      case 'US':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#bd3d44" d="M0 0h640v480H0z" />
            <path
              stroke="#fff"
              strokeWidth="37"
              d="M0 55h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640"
            />
            <path fill="#192f5d" d="M0 0h260v222H0z" />
            <path
              fill="#fff"
              d="M25 25h10v10H25zm40 0h10v10H65zm40 0h10v10h-10zm40 0h10v10h-10zm40 0h10v10h-10z"
            />
          </svg>
        )
      case 'SG':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#fff" d="M0 0h640v480H0z" />
            <path fill="#ed2939" d="M0 0h640v240H0z" />
            <circle cx="150" cy="120" r="60" fill="#fff" />
            <circle cx="170" cy="120" r="60" fill="#ed2939" />
          </svg>
        )
      case 'TW':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#fe0000" d="M0 0h640v480H0z" />
            <path fill="#000095" d="M0 0h320v240H0z" />
            <circle cx="160" cy="120" r="45" fill="#fff" />
            <circle cx="160" cy="120" r="35" fill="#000095" />
            <circle cx="160" cy="120" r="22" fill="#fff" />
          </svg>
        )
      case 'KR':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#fff" d="M0 0h640v480H0z" />
            <circle cx="320" cy="240" r="90" fill="#c60c30" />
            <path
              fill="#003478"
              d="M230 240a90 90 0 0 0 180 0 45 45 0 0 1-90 0 45 45 0 0 0-90 0z"
            />
          </svg>
        )
      case 'UK':
      case 'GB':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#012169" d="M0 0h640v480H0z" />
            <path stroke="#fff" strokeWidth="60" d="M0 0l640 480M640 0L0 480" />
            <path
              stroke="#c8102e"
              strokeWidth="40"
              d="M0 0l640 480M640 0L0 480"
            />
            <path stroke="#fff" strokeWidth="100" d="M320 0v480M0 240h640" />
            <path stroke="#c8102e" strokeWidth="60" d="M320 0v480M0 240h640" />
          </svg>
        )
      case 'DE':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#000" d="M0 0h640v160H0z" />
            <path fill="#d00" d="M0 160h640v160H0z" />
            <path fill="#ffce00" d="M0 320h640v160H0z" />
          </svg>
        )
      case 'FR':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#002395" d="M0 0h213v480H0z" />
            <path fill="#fff" d="M213 0h214v480H213z" />
            <path fill="#ed2939" d="M427 0h213v480H427z" />
          </svg>
        )
      case 'CA':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#d52b1e" d="M0 0h640v480H0z" />
            <path fill="#fff" d="M160 0h320v480H160z" />
            <circle cx="320" cy="240" r="60" fill="#d52b1e" />
          </svg>
        )
      case 'AU':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#00008b" d="M0 0h640v480H0z" />
            <path stroke="#fff" strokeWidth="40" d="M0 0v240h320V0z" />
            <circle cx="480" cy="240" r="30" fill="#fff" />
          </svg>
        )
      case 'NL':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#ae1c28" d="M0 0h640v160H0z" />
            <path fill="#fff" d="M0 160h640v160H0z" />
            <path fill="#21468b" d="M0 320h640v160H0z" />
          </svg>
        )
      case 'RU':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#fff" d="M0 0h640v160H0z" />
            <path fill="#0039a6" d="M0 160h640v160H0z" />
            <path fill="#d52b1e" d="M0 320h640v160H0z" />
          </svg>
        )
      case 'IN':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#ff9933" d="M0 0h640v160H0z" />
            <path fill="#fff" d="M0 160h640v160H0z" />
            <path fill="#138808" d="M0 320h640v160H0z" />
            <circle cx="320" cy="240" r="40" fill="#000080" />
          </svg>
        )
      case 'TR':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#e30a17" d="M0 0h640v480H0z" />
            <circle cx="280" cy="240" r="100" fill="#fff" />
            <circle cx="310" cy="240" r="80" fill="#e30a17" />
          </svg>
        )
      case 'AE':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#00732f" d="M0 0h640v160H0z" />
            <path fill="#fff" d="M0 160h640v160H0z" />
            <path fill="#000" d="M0 320h640v160H0z" />
            <path fill="#f00" d="M0 0h160v480H0z" />
          </svg>
        )
      case 'CN':
        return (
          <svg
            viewBox="0 0 640 480"
            className={`${dim} rounded-xs shrink-0 shadow-2xs`}
          >
            <path fill="#de2910" d="M0 0h640v480H0z" />
            <path fill="#ffde00" d="M120 120l-15 45 40-30h-50l40 30z" />
          </svg>
        )
      default:
        return <span className="text-xs shrink-0">🌐</span>
    }
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
    >
      {renderSvg()}
    </span>
  )
}
