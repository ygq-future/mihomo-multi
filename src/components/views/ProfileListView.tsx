import { FileCode, Layers, Plus } from 'lucide-react'
import type React from 'react'

export const ProfileListView: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          已导入配置: <b className="text-foreground">0</b>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-accent transition-colors"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>导入本地 YAML</span>
          </button>

          <button
            type="button"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加远程订阅</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <Layers className="w-6 h-6" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h3 className="text-sm font-semibold text-foreground">
            尚未添加任何订阅配置
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            支持标准 Clash / Mihomo 订阅 URL 以及包含 proxies
            的本地配置文件，系统将自动解析可用节点池并支持自动定时静默更新。
          </p>
        </div>
      </div>
    </div>
  )
}
