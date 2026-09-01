import { Network, Plus, ShieldAlert, Sparkles } from 'lucide-react'
import type React from 'react'

export const PortTableView: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            总监听端口: <b className="text-foreground">0</b>
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="text-xs font-medium text-emerald-500">
            已启用: 0
          </span>
        </div>

        <button
          type="button"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加端口映射</span>
        </button>
      </div>

      {/* Empty State Card */}
      <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <Network className="w-6 h-6" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h3 className="text-sm font-semibold text-foreground">
            暂无端口映射规则
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            点击上方「添加端口映射」按钮，分配独立本地入站端口（如
            7891、7892）并绑定至指定的订阅代理节点。
          </p>
        </div>

        <div className="pt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            毫秒级配置热重载
          </span>
          <span className="flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" />
            1:1 确定性路由
          </span>
        </div>
      </div>
    </div>
  )
}
