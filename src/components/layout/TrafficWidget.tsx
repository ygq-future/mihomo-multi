import { Download, Upload } from 'lucide-react'
import type React from 'react'
import { useTraffic } from '../../hooks/useTraffic'
import { useWindowVisibility } from '../../services/useWindowVisibility'
import { formatCompactTraffic, formatTraffic } from '../../utils/traffic'
import { useTranslation } from '../../i18n'

interface TrafficWidgetProps {
  collapsed: boolean
  isRunning: boolean
  port?: number
  secret?: string
}

export const TrafficWidget: React.FC<TrafficWidgetProps> = ({
  collapsed,
  isRunning,
  port,
  secret,
}) => {
  const { t } = useTranslation()
  const isVisible = useWindowVisibility()
  const traffic = useTraffic(isRunning, port, secret, isVisible)

  if (collapsed) {
    return (
      <div
        className="p-1.5 mx-2 mb-2 rounded-xl border border-border bg-background/50 flex flex-col items-center gap-1 cursor-default select-none"
        title={t('traffic.title')}
      >
        <div className="flex flex-col items-center w-full py-0.5">
          <Upload className="w-3 h-3 text-sky-500 shrink-0 mb-0.5" />
          <span className="font-mono text-[10px] text-foreground font-medium leading-none text-center">
            {formatCompactTraffic(traffic.up)}
          </span>
        </div>

        <div className="w-4/5 h-px bg-border/40" />

        <div className="flex flex-col items-center w-full py-0.5">
          <Download className="w-3 h-3 text-emerald-500 shrink-0 mb-0.5" />
          <span className="font-mono text-[10px] text-foreground font-medium leading-none text-center">
            {formatCompactTraffic(traffic.down)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-2.5 mx-2.5 mb-2 rounded-xl border border-border bg-background/50 space-y-2 select-none">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium">{t('traffic.liveSpeed')}</span>
        <span className="text-[10px] text-muted-foreground/70 font-mono">
          {t('traffic.total')}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 pt-0.5">
        <div className="flex items-center justify-between py-0.5">
          <div className="flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground">
              {t('traffic.upload')}
            </span>
          </div>
          <span className="font-mono text-[10px] text-foreground font-medium">
            {formatTraffic(traffic.up)}
          </span>
        </div>
        <div className="h-px bg-border/40" />
        <div className="flex items-center justify-between py-0.5">
          <div className="flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground">
              {t('traffic.download')}
            </span>
          </div>
          <span className="font-mono text-[10px] text-foreground font-medium">
            {formatTraffic(traffic.down)}
          </span>
        </div>
      </div>
    </div>
  )
}
