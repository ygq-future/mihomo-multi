import { Loader2, Network, ShieldCheck, X, Zap } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type { InboundProtocol, PortMapping } from '../../types'
import { Button, Input, Modal, Select, toast } from '../common'

export interface EditDirectPortModalProps {
  isOpen: boolean
  onClose: () => void
  directMapping: PortMapping
  onSuccess?: () => void
}

export const EditDirectPortModal: React.FC<EditDirectPortModalProps> = ({
  isOpen,
  onClose,
  directMapping,
  onSuccess,
}) => {
  const { fetchPortMappings, fetchStatus } = useAppStore()
  const [port, setPort] = useState<string>(String(directMapping.port))
  const [protocol, setProtocol] = useState<InboundProtocol>(
    directMapping.protocol || 'mixed',
  )
  const [description, setDescription] = useState<string>(
    directMapping.description || '直连监听 (流量直通不走代理)',
  )

  const [isCheckingPort, setIsCheckingPort] = useState(false)
  const [isPortAvailable, setIsPortAvailable] = useState<boolean | null>(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setPort(String(directMapping.port))
      setProtocol(directMapping.protocol || 'mixed')
      setDescription(directMapping.description || '直连监听 (流量直通不走代理)')
      setIsPortAvailable(true)
      setError(null)
    }
  }, [isOpen, directMapping])

  // Port debounce check
  useEffect(() => {
    const portNum = Number.parseInt(port, 10)
    if (Number.isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setIsPortAvailable(null)
      return
    }

    if (portNum === directMapping.port) {
      setIsPortAvailable(true)
      return
    }

    const timer = setTimeout(async () => {
      setIsCheckingPort(true)
      try {
        const available = await api.checkPortAvailable(
          portNum,
          directMapping.id,
        )
        setIsPortAvailable(available)
      } catch {
        setIsPortAvailable(null)
      } finally {
        setIsCheckingPort(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [port, directMapping.port, directMapping.id])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const portNum = Number.parseInt(port, 10)
    if (Number.isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setError('端口号必须在 1024 ~ 65535 之间')
      return
    }

    if (isPortAvailable === false) {
      setError(`本地端口 ${portNum} 已被占用，请换用其他端口`)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const updatedMapping: PortMapping = {
        ...directMapping,
        port: portNum,
        protocol,
        description: description.trim() || '直连监听 (流量直通不走代理)',
      }

      await api.savePortMapping(updatedMapping)
      await fetchPortMappings()
      fetchStatus().catch(() => {})
      toast.success(`直连监听端口已更新为 ${portNum}`)
      onSuccess?.()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(`保存失败: ${msg}`)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="修改直连监听端口"
      subtitle="自定义本地直连监听端口与入站协议"
      icon={<Zap className="w-4 h-4 text-primary" />}
      maxWidth="md"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="edit-direct-port-form"
            variant="primary"
            size="sm"
            loading={isSaving}
            disabled={
              isSaving ||
              isPortAvailable === false ||
              !port ||
              Number(port) < 1024 ||
              Number(port) > 65535
            }
          >
            保存配置
          </Button>
        </>
      }
    >
      <form
        id="edit-direct-port-form"
        onSubmit={handleSave}
        className="p-5 space-y-4"
      >
        <div className="p-3 text-xs bg-primary/5 border border-primary/20 text-foreground rounded-lg flex items-start gap-2">
          <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-primary">直连监听说明</span>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              此端口流量直接直通互联网（不经过任何节点）。常用于在开启系统代理时，将浏览器插件（如
              SwitchyOmega）代理设为此端口以临时直连。
            </p>
          </div>
        </div>

        {error && (
          <div className="p-2.5 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg">
            {error}
          </div>
        )}

        {/* Port and Protocol */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="direct-port-input"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              本地监听端口 <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Input
                id="direct-port-input"
                type="number"
                integerOnly
                step={1}
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="7878"
                prefixIcon={<Network className="w-4 h-4" />}
                required
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {isCheckingPort ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                ) : isPortAvailable === true ? (
                  <span
                    className="text-[11px] text-emerald-500 flex items-center gap-0.5"
                    title="端口可用"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    可用
                  </span>
                ) : isPortAvailable === false ? (
                  <span
                    className="text-[11px] text-rose-500 flex items-center gap-0.5"
                    title="端口已被占用"
                  >
                    <X className="w-3.5 h-3.5" />
                    已占用
                  </span>
                ) : null}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              默认建议: 7878 (范围 1024 ~ 65535)
            </p>
          </div>

          <div>
            <label
              htmlFor="direct-protocol-select"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              入站协议
            </label>
            <Select
              id="direct-protocol-select"
              value={protocol}
              onChange={(val) => setProtocol(val as InboundProtocol)}
              options={[
                { value: 'mixed', label: 'Mixed (HTTP + SOCKS5)' },
                { value: 'http', label: 'HTTP 代理' },
                { value: 'socks5', label: 'SOCKS5 代理' },
              ]}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              推荐 Mixed 兼顾 HTTP/SOCKS5
            </p>
          </div>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="direct-description-input"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            卡片备注说明
          </label>
          <Input
            id="direct-description-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="直连监听 (流量直通不走代理)"
          />
        </div>
      </form>
    </Modal>
  )
}
