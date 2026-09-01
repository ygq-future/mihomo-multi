import type React from 'react'
import { useAppStore } from '../../stores/appStore'
import { PortTableView } from '../views/PortTableView'
import { ProfileListView } from '../views/ProfileListView'
import { ProxyGridView } from '../views/ProxyGridView'
import { SettingView } from '../views/SettingView'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

export const Shell: React.FC = () => {
  const { activeTab } = useAppStore()

  const renderContent = () => {
    switch (activeTab) {
      case 'ports':
        return <PortTableView />
      case 'proxies':
        return <ProxyGridView />
      case 'profiles':
        return <ProfileListView />
      case 'settings':
        return <SettingView />
      default:
        return <PortTableView />
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">{renderContent()}</main>
      </div>
    </div>
  )
}
