import { Check, Loader2, Network, ShieldCheck, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import * as api from '../../services/tauri'
import { useAppStore } from '../../stores/appStore'
import type { InboundProtocol } from '../../types'
import { Button, Input, Modal, Select } from '../common'

export interface AddPortModalProps {
  isOpen: boolean
  onClose: () => void
  initialProfileId?: string
  initialNodeName?: string
}

export const AddPortModal: React.FC<AddPortModalProps> = ({
  isOpen,
  onClose,
  initialProfileId,
  initialNodeName,
}) => {
  const { profiles, profileNodes, fetchProfileNodes, setActiveTab } =
    useAppStore()

  const [port, setPort] = useState<string>('7891')
  const [protocol, setProtocol] = useState<InboundProtocol>('mixed')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [selectedNodeName, setSelectedNodeName] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [isCheckingPort, setIsCheckingPort] = useState(false)
  const [isPortAvailable, setIsPortAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Initialize or reset fields when opened
  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSuccess(false)
      const profId = initialProfileId || (profiles[0] ? profiles[0].id : '')
      setSelectedProfileId(profId)
      setSelectedNodeName(initialNodeName || '')
      setPort('7891')
      setProtocol('mixed')
      setDescription('')
    }
  }, [isOpen, initialProfileId, initialNodeName, profiles])

  // Ensure nodes for selected profile are loaded
  useEffect(() => {
    if (selectedProfileId && !profileNodes[selectedProfileId]) {
      fetchProfileNodes(selectedProfileId).catch(() => {})
    }
  }, [selectedProfileId, profileNodes, fetchProfileNodes])

  // Check port availability on debounced port change
  useEffect(() => {
    const portNum = Number.parseInt(port, 10)
    if (!portNum || portNum < 1024 || portNum > 65535) {
      setIsPortAvailable(null)
      return
    }

    let isMounted = true
    setIsCheckingPort(true)

    const timer = setTimeout(async () => {
      try {
        const available = await api.checkPortAvailable(portNum)
        if (isMounted) {
          setIsPortAvailable(available)
          setIsCheckingPort(false)
        }
      } catch {
        if (isMounted) {
          setIsPortAvailable(true)
          setIsCheckingPort(false)
        }
      }
    }, 250)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [port])

  const availableNodes = useMemo(() => {
    if (!selectedProfileId) return []
    return profileNodes[selectedProfileId] || []
  }, [selectedProfileId, profileNodes])

  const profileOptions = useMemo(() => {
    return profiles.map((p) => ({
      value: p.id,
      label: `${p.name} (${p.nodeCount} 节点)`,
    }))
  }, [profiles])

  const nodeOptions = useMemo(() => {
    return availableNodes.map((n) => ({
      value: n.name,
      label: `${n.name} (${n.type.toUpperCase()})`,
    }))
  }, [availableNodes])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const portNum = Number.parseInt(port, 10)
    if (!portNum || portNum < 1024 || portNum > 65535) {
      setError('端口号必须在 1024 ~ 65535 范围内')
      return
    }

    if (isPortAvailable === false) {
      setError(`本地端口 ${portNum} 已被占用，请更换其他端口`)
      return
    }

    if (!selectedProfileId) {
      setError('请选择所属订阅')
      return
    }

    if (!selectedNodeName) {
      setError('请选择绑定的代理节点')
      return
    }

    setSuccess(true)
    setTimeout(() => {
      onClose()
      setActiveTab('ports')
    }, 600)
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="快速绑定到端口监听"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-destructive hover:opacity-80"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {success && (
          <div className="p-3 text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-lg flex items-center gap-2">
            <Check className="w-4 h-4" />
            <span>端口绑定配置成功，已跳转至端口管理列表</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="port-input"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              本地监听端口
            </label>
            <div className="relative">
              <Input
                id="port-input"
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="7891"
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
          </div>

          <div>
            <label
              htmlFor="protocol-select"
              className="block text-xs font-medium text-muted-foreground mb-1.5"
            >
              入站协议
            </label>
            <Select
              id="protocol-select"
              value={protocol}
              onChange={(val) => setProtocol(val as InboundProtocol)}
              options={[
                { value: 'mixed', label: 'Mixed (HTTP + SOCKS5)' },
                { value: 'http', label: 'HTTP 代理' },
                { value: 'socks5', label: 'SOCKS5 代理' },
              ]}
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="profile-select"
            className="block text-xs font-medium text-muted-foreground mb-1.5"
          >
            所属订阅配置
          </label>
          <Select
            id="profile-select"
            value={selectedProfileId}
            onChange={(val) => {
              setSelectedProfileId(String(val))
              setSelectedNodeName('')
            }}
            options={profileOptions}
            placeholder="选择订阅配置"
          />
        </div>

        <div>
          <label
            htmlFor="node-select"
            className="block text-xs font-medium text-muted-foreground mb-1.5"
          >
            绑定代理节点
          </label>
          <Select
            id="node-select"
            value={selectedNodeName}
            onChange={(val) => setSelectedNodeName(String(val))}
            options={nodeOptions}
            placeholder={
              availableNodes.length === 0
                ? '该订阅暂无节点'
                : '选择要绑定的节点'
            }
          />
        </div>

        <div>
          <label
            htmlFor="desc-input"
            className="block text-xs font-medium text-muted-foreground mb-1.5"
          >
            备注描述 (可选)
          </label>
          <Input
            id="desc-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例如：用于指纹浏览器环境 01"
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={success}
          >
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={
              success || !selectedNodeName || !port || isPortAvailable === false
            }
          >
            确认创建
          </Button>
        </div>
      </form>
    </Modal>
  )
}
