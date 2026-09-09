import { Download, Upload } from 'lucide-react'
import type React from 'react'
import { useTraffic } from '../../hooks/useTraffic'
import { useWindowVisibility } from '../../services/useWindowVisibility'
import { formatCompactTraffic, formatTraffic } from '../../utils/traffic'

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
  const isVisible = useWindowVisibility()
  const traffic = useTraffic(isRunning, port, secret, isVisible)

  if (collapsed) {
    return (
      <div
        className="p-1.5 mx-2 mb-2 rounded-xl border border-border bg-background/50 flex flex-col items-center gap-1 cursor-default select-none"
        title="实时网速汇总"
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
    <div className="p-2.5 mx-2.5 mb-2 rounded-xl border border-border bg-background/50 space-y-1.5 select-none">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium">实时网速</span>
        <span className="text-[10px] text-muted-foreground/70 font-mono">
          汇总
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div className="p-1.5 rounded-lg bg-card/60 border border-border/40 flex items-center gap-1.5 min-w-0">
          <Upload className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground leading-none">
              上传
            </div>
            <div className="font-mono text-[10px] text-foreground font-medium truncate mt-0.5">
              {formatTraffic(traffic.up)}
            </div>
          </div>
        </div>
        <div className="p-1.5 rounded-lg bg-card/60 border border-border/40 flex items-center gap-1.5 min-w-0">
          <Download className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground leading-none">
              下载
            </div>
            <div className="font-mono text-[10px] text-foreground font-medium truncate mt-0.5">
              {formatTraffic(traffic.down)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
