import { ArrowDownToLine, Copy, Loader2, ShieldCheck } from 'lucide-react'
import type React from 'react'

export interface NodeEgressActionsProps {
  isProbingIp: boolean
  isProbingQuality?: boolean
  copyTitle: string
  copyLabel?: string
  probingLabel: string
  qualityLabel: string
  qualityTitle: string
  onCopyIp: () => void
  onOpenQuality: () => void
  onDownloadTest?: () => void
  downloadLabel?: string
  downloadTitle?: string
  hoverScope?: 'name' | 'fbname'
  hidden?: boolean
}

const HOVER_VISIBILITY: Record<'name' | 'fbname', string> = {
  name: 'opacity-0 scale-95 translate-x-1 pointer-events-none group-hover/name:opacity-100 group-hover/name:scale-100 group-hover/name:translate-x-0 group-hover/name:pointer-events-auto group-has-[:focus-visible]/name:opacity-100 group-has-[:focus-visible]/name:scale-100 group-has-[:focus-visible]/name:translate-x-0 group-has-[:focus-visible]/name:pointer-events-auto',
  fbname:
    'opacity-0 scale-95 translate-x-1 pointer-events-none group-hover/fbname:opacity-100 group-hover/fbname:scale-100 group-hover/fbname:translate-x-0 group-hover/fbname:pointer-events-auto group-has-[:focus-visible]/fbname:opacity-100 group-has-[:focus-visible]/fbname:scale-100 group-has-[:focus-visible]/fbname:translate-x-0 group-has-[:focus-visible]/fbname:pointer-events-auto',
}
export const NodeEgressActions: React.FC<NodeEgressActionsProps> = ({
  isProbingIp,
  isProbingQuality = false,
  copyTitle,
  copyLabel = 'IP',
  probingLabel,
  qualityLabel,
  qualityTitle,
  onCopyIp,
  onOpenQuality,
  onDownloadTest,
  downloadLabel,
  downloadTitle,
  hoverScope = 'name',
  hidden = false,
}) => {
  const isBusy = isProbingIp || isProbingQuality
  const visibilityClass = hidden
    ? 'opacity-0 pointer-events-none'
    : isBusy
      ? 'opacity-100 scale-100 translate-x-0 pointer-events-auto'
      : HOVER_VISIBILITY[hoverScope]

  const heightClass = 'h-5 px-2'
  const qualityHeightClass = 'h-5 px-1.5'

  const handleCopyClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.detail > 0) {
      e.currentTarget.blur()
    }
    if (!isProbingIp) {
      onCopyIp()
    }
  }

  const handleQualityClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.detail > 0) {
      e.currentTarget.blur()
    }
    onOpenQuality()
  }

  const copyClassName = `inline-flex items-center gap-1 ${heightClass} rounded-md text-[10px] leading-none font-semibold whitespace-nowrap shrink-0 bg-primary text-primary-foreground hover:opacity-90 shadow-md cursor-pointer disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-opacity`
  const qualityClassName = `inline-flex items-center gap-1 ${qualityHeightClass} rounded-md text-[10px] leading-none font-semibold whitespace-nowrap shrink-0 bg-card/95 border border-border text-foreground hover:border-primary/50 hover:text-primary shadow-md backdrop-blur-xs cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-colors`

  return (
    <div
      data-no-drag="true"
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 inline-flex items-center gap-1 transition-all duration-200 ease-out ${visibilityClass}`}
    >
      <button
        type="button"
        data-no-drag="true"
        disabled={isProbingIp}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleCopyClick}
        className={copyClassName}
        title={copyTitle}
      >
        {isProbingIp ? (
          <>
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            <span>{probingLabel}</span>
          </>
        ) : (
          <>
            <Copy className="w-2.5 h-2.5" />
            <span>{copyLabel}</span>
          </>
        )}
      </button>
      <button
        type="button"
        data-no-drag="true"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleQualityClick}
        className={qualityClassName}
        title={qualityTitle}
        aria-label={qualityTitle}
      >
        {isProbingQuality ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin text-primary" />
        ) : (
          <ShieldCheck className="w-2.5 h-2.5 text-emerald-500" />
        )}
        <span>{qualityLabel}</span>
      </button>
      {onDownloadTest && (
        <button
          type="button"
          data-no-drag="true"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            if (e.detail > 0) e.currentTarget.blur()
            onDownloadTest()
          }}
          className={qualityClassName}
          title={downloadTitle}
          aria-label={downloadTitle}
        >
          <ArrowDownToLine className="w-2.5 h-2.5 text-sky-500" />
          {downloadLabel && <span>{downloadLabel}</span>}
        </button>
      )}
    </div>
  )
}
