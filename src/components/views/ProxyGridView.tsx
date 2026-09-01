import { Compass, Gauge, Search } from 'lucide-react'
import type React from 'react'

export const ProxyGridView: React.FC = () => {
  return (
    <div className="p-6 space-y-6">
      {/* Search & Batch Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索节点名称、地区、服务器..."
            className="w-full pl-9 pr-4 py-2 rounded-md bg-card border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          type="button"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-secondary text-secondary-foreground text-xs font-medium hover:bg-accent transition-colors"
        >
          <Gauge className="w-3.5 h-3.5" />
          <span>全量并发测速</span>
        </button>
      </div>

      {/* Empty State */}
      <div className="border border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center text-center space-y-4 bg-card/30">
        <div className="w-12 h-12 rounded-full bg-secondary text-muted-foreground flex items-center justify-center">
          <Compass className="w-6 h-6" />
        </div>
        <div className="space-y-1 max-w-sm">
          <h3 className="text-sm font-semibold text-foreground">
            暂无可用代理节点
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            请前往「配置订阅」页面导入远程订阅链接或本地 Clash YAML 配置文件。
          </p>
        </div>
      </div>
    </div>
  )
}
