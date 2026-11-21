import type { TranslationKey } from './zh-CN'

export const enUS: Record<TranslationKey, string> = {
  // Common
  'common.save': 'Save',
  'common.saving': 'Saving...',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.refresh': 'Refresh',
  'common.loading': 'Loading...',
  'common.search': 'Search',
  'common.enable': 'Enable',
  'common.disable': 'Disable',
  'common.enabled': 'Enabled',
  'common.disabled': 'Disabled',
  'common.unknown': 'Unknown',
  'common.none': 'None',
  'common.all': 'All',
  'common.retry': 'Retry',
  'common.reset': 'Reset',

  // Navigation
  'nav.ports': 'Port Mappings',
  'nav.proxies': 'Proxy Nodes',
  'nav.profiles': 'Profiles',
  'nav.connections': 'Connections',
  'nav.settings': 'Settings',
  'nav.collapse': 'Collapse Sidebar',
  'nav.expand': 'Expand Sidebar',

  // Header & Core Status
  'header.coreRunning': 'Core Running',
  'nav.settingCore': 'Core & Network',
  'nav.settingProxy': 'System Proxy',
  'nav.settingTun': 'TUN Mode',
  'nav.settingAppearance': 'Appearance',
  'nav.settingSystem': 'Window & System',
  'nav.settingStorage': 'Storage',
  'nav.settingAbout': 'About & Updates',
  'nav.appSubtitle': 'Multi-Port Proxy',
  'nav.mihomoCore': 'Mihomo Core',
  'nav.running': 'Running',
  'nav.stopped': 'Stopped',
  'nav.controlPort': 'API Port',
  'nav.coreTooltip': 'Mihomo Core: {status}{extra}',

  // Header
  'header.portsTitle': 'Port Listener Manager',
  'header.portsSubtitle':
    'Configure 1:1 deterministic mapping between local inbound ports and proxy nodes',
  'header.proxiesTitle': 'Proxy Nodes',
  'header.proxiesSubtitle':
    'Browse subscription node pools and run concurrent latency tests',
  'header.profilesTitle': 'Profile Management',
  'header.profilesSubtitle':
    'Import and auto-sync remote subscriptions or local Clash YAML configs',
  'header.connectionsTitle': 'Live Connections',
  'header.connectionsSubtitle':
    'Monitor active network connections, real-time speed, and close connections',
  'header.settingsTitle': 'Settings',
  'header.settingsSubtitle':
    'Manage app preferences, data storage, and Mihomo core parameters',
  'header.newVersionTitle': 'New version available, click to update',
  'header.newVersionBadge': 'New v{version}',
  'header.portChangedRestart':
    'Controller port changed to {port}, restart required',
  'header.portChangedStart':
    'Controller port changed to {port}, start required',
  'header.restartToApply': 'Restart',
  'header.startToApply': 'Start',
  'header.retryStart': 'Retry Start',
  // Traffic Widget
  'traffic.title': 'Live Speed Summary',
  'traffic.liveSpeed': 'Live Speed',
  'traffic.total': 'Total',
  'traffic.upload': 'Upload',
  'traffic.download': 'Download',

  // Shell / Close Dialog
  'shell.exitTitle': 'Exit Application',
  'shell.exitSubtitle': 'Are you sure you want to quit?',
  'shell.minimizeToTray': 'Minimize to Tray',
  'shell.exitApp': 'Quit',
  'shell.minimizeDesc':
    'Minimize to tray is enabled. The main window will hide to the system tray while background proxies continue running.',
  'shell.exitDesc':
    'Quitting will stop the Mihomo core and interrupt all port proxy forwarding.',
  'shell.rememberMinimize':
    'Minimize to system tray (keep running in background and remember choice)',
  // Port Mappings
  'ports.egressDetectDone': 'Egress detected: {ip} ({region})',
  'ports.egressDetectFail': 'Egress detection failed: {err}',
  'ports.nodeLabel': 'node',
  'ports.fallbackNodeLabel': 'fallback node',
  'ports.copiedNodeEgress': 'Copied {label} egress IP: {ip}{region}',
  'ports.probeNodeEgressFail': 'Failed to probe {label} egress IP: {err}',
  'ports.copiedDirectEgress': 'Copied direct egress IP: {ip}{region}',
  'ports.directEgressFail': 'Direct egress IP detection failed',
  'ports.copiedChainEgress': 'Copied chain egress IP: {ip}{region}',
  'ports.copyClipboardFail':
    'Failed to copy to clipboard, please copy manually',
  'ports.chainEgressFail': 'Chain egress detection failed: {err}',
  'ports.quickCopyIpSet': 'Quick copy IP set to: {ip}',
  'ports.loopbackOption': '127.0.0.1 (Loopback)',
  'ports.takeoverOff': 'Off',
  'ports.envProxyUnbound': 'Unbound terminal env proxy from port {port}',
  'ports.envProxyBound': 'Bound port {port} as global terminal env proxy',
  'ports.envProxyFail': 'Failed to set terminal proxy: {err}',
  'ports.directNoSysProxy':
    'Direct listener cannot be set as system proxy; it is for targeted direct traffic only',
  'ports.portDisabledWithSysProxy':
    'Port {port} disabled; system proxy and env vars cleared',
  'ports.portDisabled': 'Port {port} disabled',
  'ports.portSysProxyUnbound':
    'System proxy unbound from port {port}; listener kept active',
  'ports.portEnabled': 'Port {port} listener enabled',
  'ports.portSysProxySetWithEnv':
    'Port {port} set as system proxy and env vars synced',
  'ports.portSysProxySet': 'Port {port} set as system proxy',
  'ports.portDeletedWithSysProxy': 'Port {port} deleted; system proxy cleared',
  'ports.portDeleted': 'Port {port} mapping deleted',
  'ports.latencyDone': 'Port {port} latency: {latency} ms',
  'ports.fallbackLatencyDone': 'Port {port} fallback latency: {latency} ms',
  'ports.manualFallbackOn': 'Manual fallback node enabled',
  'ports.manualFallbackOff': 'Restored automatic fallback mode',
  'ports.manualFallbackFail': 'Failed to toggle fallback mode',
  'ports.allLatencyDone': 'All enabled ports tested',
  'ports.tunDisabled': 'TUN mode disabled',
  'ports.sysProxyDisabledWithEnv': 'System proxy disabled and env vars cleared',
  'ports.sysProxyDisabled': 'System proxy disabled',
  'ports.takeoverDisableFail': 'Failed to disable takeover mode: {err}',
  'ports.noEnabledPort':
    'No enabled listener port available. Please enable a port first.',
  'ports.sysProxyEnableFail': 'Failed to enable system proxy: {err}',
  'ports.tunAdminRestart':
    'TUN mode requires administrator privileges. Restarting as admin…',
  'ports.tunEnabled': 'TUN mode enabled, global egress follows port {port}',
  'ports.tunEnableFail': 'Failed to enable TUN mode: {err}',
  'ports.tunPortSwitched': 'Switched TUN egress to port {port}',
  'ports.sysProxyPortSwitched': 'Switched system proxy port to {port}',
  'ports.preselectedPortSet': 'Preselected egress port set to {port}',
  'ports.updateExitPortFail': 'Failed to update egress port: {err}',
  'ports.tunMode': 'TUN Mode',
  'ports.systemProxy': 'System Proxy',
  'ports.takeoverDisabled': 'Takeover Off',
  'ports.takeoverMode': 'Takeover Mode',
  'ports.noProxyPortAvailable': 'No proxy port available',
  'ports.needElevationTitle':
    'TUN mode requires administrator privileges to create a virtual NIC. Click to restart as admin.',
  'ports.needElevation': 'Elevate',
  'ports.envProxyClosed': 'Terminal env proxy disabled',
  'ports.envProxySwitched': 'Terminal env proxy switched to port {port}',
  'ports.testingAll': 'Testing all ports...',
  'ports.testAll': 'Test all ports',
  'ports.globalRulesTitle': 'Manage global website routing rules{extra}',
  'ports.globalRulesActive': ' ({count} active)',
  'ports.addPort': 'Add Port',
  'ports.loadingList': 'Loading port mappings...',
  'ports.loadFailTitle': 'Failed to load port mappings',
  'ports.emptyTitle': 'No port mappings yet',
  'ports.emptyDesc':
    'Click the button above to assign a local inbound port (e.g. 7891, 7892) and bind it 1:1 to a proxy node, or chain it with an authenticated residential exit.',
  'ports.addFirstPort': 'Add First Port Mapping',
  'ports.unknownProfile': 'Unknown Profile',
  'ports.statusCoreStopped':
    'Mihomo core is stopped; this port is not listening',
  'ports.statusOccupied':
    'Local port {port} is occupied by another application and was skipped',
  'ports.statusFallbackActive':
    'Primary node failed; currently using same-region fallback node',
  'ports.statusListening': 'Listening normally',
  'ports.directBadgeTitle':
    'All traffic on this port goes directly to the internet without any proxy',
  'ports.directBadge': 'Direct',
  'ports.chainBadgeTitle':
    'All traffic routes via upstream {node} → residential exit {exit}; Bypass CN, fallback, and rules are disabled',
  'ports.chainMissingTitle':
    'Residential exit config missing; this port will reject traffic',
  'ports.chainBadge': 'Chain',
  'ports.bypassCnTitle': 'Mainland China domains and IPs go direct (DIRECT)',
  'ports.bypassCn': 'Bypass CN',
  'ports.globalProxyTitle': 'All traffic routes through the bound proxy node',
  'ports.globalProxy': 'Global',
  'ports.tunExitTitle': 'This port is the global TUN mode egress',
  'ports.tunExit': 'TUN Exit',
  'ports.envExitTitle':
    'This port is the global terminal env proxy (http_proxy / all_proxy)',
  'ports.envExit': 'ENV Proxy',
  'ports.rulesBadgeTitle':
    '{count} website routing rule(s) configured, click to manage',
  'ports.rulesBadge': '{count} Rules',
  'ports.listeningStopped': '(Stopped)',
  'ports.clickCopyDirectIp': 'Click to copy direct egress IP: {ip}',
  'ports.detectingOrNoIp': 'Detecting or public IP not yet acquired',
  'ports.probingIp': 'Probing IP...',
  'ports.clickToDetectIp': 'Click to test & detect IP',
  'ports.notListening': 'Not listening',
  'ports.egressDirectTitle': 'Egress: Local DIRECT connection',
  'ports.egressDirectLabel': 'DIRECT',
  'ports.directTrafficDesc': 'Direct traffic · Bypasses all proxy nodes',
  'ports.notEnabledParen': '(Disabled)',
  'ports.chainExitMissingShort': 'Exit missing',
  'ports.probingChainIp': 'Probing chain egress IP via local mapped port...',
  'ports.portDisabledNoChainProbe':
    'Port is disabled; cannot probe chain egress',
  'ports.clickCopyChainIp': 'Click to copy chain egress IP: {ip}{region}',
  'ports.clickProbeChainIp':
    'Click to probe & copy final egress IP via local port',
  'ports.probingShort': 'Probing',
  'ports.egressIpShort': 'Exit IP',
  'ports.finalExitResidentialTitle':
    'Final Egress: Authenticated Residential Proxy',
  'ports.residentialExitLabel': 'Residential Exit',
  'ports.upstreamLabel': 'Upstream',
  'ports.belongsToProfile': 'Profile: {name}',
  'ports.upstreamMissingTitle':
    'Upstream node not found in profile; chain port will reject traffic',
  'ports.profileDeletedReject': 'Profile deleted (Rejected)',
  'ports.profileEmptyReject': 'Profile empty (Rejected)',
  'ports.chainInvalidReject': 'Chain invalid (Rejected)',
  'ports.exitDeletedTitle':
    'Residential exit was deleted; this port will reject traffic',
  'ports.exitMissingReject': 'Exit missing (Rejected)',
  'ports.chainUntestedTitle':
    'Untested. Click bottom latency badge to test full chain',
  'ports.chainTimeoutTitle':
    'Chain timed out or residential exit unavailable; port will reject traffic',
  'ports.chainHealthyTitle': 'Chain (Upstream → Residential Exit) is healthy',
  'ports.untested': 'Untested',
  'ports.chainAbnormal': 'Chain Error',
  'ports.chainHealthy': 'Chain OK',
  'ports.probeFinalIpDesc': 'Probe final egress IP via local mapped port',
  'ports.clickProbeFinalIp': 'Click to probe final chain egress IP',
  'ports.portNotListening': 'Port not listening',
  'ports.primaryNodeLabel': 'Primary',
  'ports.probingEgressIp': 'Probing egress IP...',
  'ports.clickCopyNodeIp': 'Click to copy egress IP: {ip}{region}',
  'ports.clickProbeNodeIp': 'Click to probe & copy node egress IP',
  'ports.copyIpShort': 'Copy IP',
  'ports.nodeMissingDirectTitle':
    'Node not found in profile; traffic falls back to DIRECT',
  'ports.profileDeletedDirect': 'Profile deleted (DIRECT)',
  'ports.profileEmptyDirect': 'Profile empty (DIRECT)',
  'ports.nodeDriftDirect': 'Node drifted (DIRECT)',
  'ports.primaryTimeoutTitle': 'Primary node timed out or unreachable',
  'ports.primaryHealthyTitle': 'Primary node is healthy',
  'ports.abnormal': 'Error',
  'ports.normal': 'OK',
  'ports.fallbackDisabledTitle': 'Port disabled; cannot switch fallback node',
  'ports.fallbackManualTitle':
    'Manual fallback active (click to restore auto-fallback)',
  'ports.fallbackAutoTitle':
    'Primary node timed out; auto-switched to fallback node',
  'ports.fallbackStandbyTitle':
    'Click to lock traffic to fallback node manually',
  'ports.probingFallbackIp': 'Probing fallback node egress IP...',
  'ports.clickCopyFallbackIp': 'Click to copy fallback egress IP: {ip}{region}',
  'ports.clickProbeFallbackIp': 'Click to probe & copy fallback egress IP',
  'ports.manualLocked': 'Locked',
  'ports.clickRestoreAuto': 'Click for Auto',
  'ports.autoFallbackActiveTitle': 'Primary timed out; auto-fallback active',
  'ports.autoFallbackActive': 'Fallback',
  'ports.standby': 'Standby',
  'ports.clickEnableManual': 'Click to Lock',
  'ports.swapPrimaryFallbackTitle':
    'Swap primary and backup nodes (or drag backup onto primary)',
  'ports.dragFallbackHint': 'Drag onto primary node to swap',
  'ports.dropToSwapHint': 'Drop to swap',
  'ports.swapSuccess':
    'Port {port} swapped: Primary "{primary}" / Backup "{fallback}"',
  'ports.swapFail': 'Failed to swap primary and backup nodes: {err}',
  'ports.swapDuplicateNodeErr':
    'Backup node "{node}" is already bound as primary on port {port}',
  'ports.dragCardPortHint': 'Drag this card to swap its listening port',
  'ports.dragCardSwapping': 'Drop here to swap listening ports and positions',
  'ports.dropCardToSwapHint': 'Release to swap ports and positions',
  'ports.swappingPorts': 'Swapping ports...',
  'ports.swapPortsSuccess':
    'Swapped ports {firstPort} and {secondPort}: {firstNode} ↔ {secondNode}',
  'ports.swapPortsFail': 'Failed to swap listening ports: {err}',
  'ports.detectDirectEgressTitle':
    'Click to detect direct egress IP, region, and latency',
  'ports.detectEgress': 'Detect Exit',
  'ports.testChainLatencyTitle':
    'Test chain latency (Upstream → Residential Exit → Target)',
  'ports.testPortAndFallbackTitle':
    'Test port latency (both primary & fallback nodes)',
  'ports.testPortTitle': 'Test port latency',
  'ports.fallbackLatencyTitle':
    'Fallback ({node}) latency: {label} (click to test)',
  'ports.editDirectPortTitle': 'Edit direct listener port',
  'ports.fixUpstreamTitle': 'Fix broken upstream node binding',
  'ports.fixNodeTitle': 'Fix drifted/broken node binding',
  'ports.manageRulesTitle': 'Manage website routing rules ({count} configured)',
  'ports.configureRulesTitle': 'Configure website routing rules',
  'ports.editPortTitle': 'Edit port mapping',
  'ports.deletePortTitle': 'Delete port mapping',
  'ports.deleteModalTitle': 'Delete Port Mapping',
  'ports.deleteModalSubtitle': 'Delete local listener port {port}?',
  'ports.confirmDelete': 'Delete',
  'ports.deleteModalDescChain':
    'Mihomo will immediately release port {port}, and its Upstream → Residential Exit chain will stop working.',
  'ports.deleteModalDescNormal':
    'Mihomo will immediately release port {port}, and the bound proxy node will no longer receive traffic from it.',
  'ports.processHistoryTitle': 'Port Process History',
  'ports.processHistorySubtitle':
    'Applications currently or previously using port {port}',
  'ports.processHistoryActionTitle':
    'View application process history for this port',
  'ports.processHistoryLoading':
    'Checking applications associated with this port...',
  'ports.processHistoryEmpty':
    'No local application process records on this port',
  'ports.processHistoryEmptyHint':
    'Local apps that route connections through this port will be recorded automatically.',
  'ports.processHistoryActiveBadge': 'Active · {count}',
  'ports.processHistoryHits': '{count} hits',
  'ports.processHistoryLastSeen': 'Last seen: {time}',
  'ports.processHistoryRefresh': 'Refresh',
  'ports.processHistoryClear': 'Clear History',
  'ports.processHistoryCleared': 'Cleared process history for port {port}',
  'ports.deleteProcessWarningTitle':
    'The following apps were seen using or are using port {port}',
  'ports.deleteProcessWarningDesc':
    'Please check and unbind this proxy port in those apps before deleting to prevent connectivity loss.',
  'ports.timeJustNow': 'just now',
  'ports.timeMinutesAgo': '{count}m ago',
  'ports.timeHoursAgo': '{count}h ago',
  'ports.timeDaysAgo': '{count}d ago',
  // Add/Edit Port Modal
  'addPort.residentialLoadFail':
    'Failed to load residential exits, please retry',
  'addPort.protocolText': '{protocol}',
  'addPort.boundToPortDesc': 'Bound to port {port} · {protocol}',
  'addPort.usedAsUpstreamDesc': 'Upstream for port {port} · {protocol}',
  'addPort.reusableUpstreamDesc':
    'Port {port} bound · Reusable as upstream · {protocol}',
  'addPort.upstreamTag': 'Up :{port}',
  'addPort.occupiedTag': 'In use :{port}',
  'addPort.noResidentialExit': 'No residential exit',
  'addPort.noResidentialExitDesc':
    'Traffic routes directly through the selected node',
  'addPort.residentialMissing': 'Residential exit missing',
  'addPort.residentialMissingDesc':
    'This exit was deleted; please reselect or clear',
  'addPort.noFallback': 'No fallback node (single node)',
  'addPort.noFallbackDesc': 'Listen on primary node only without auto-failover',
  'addPort.fallbackOptionDesc': '{protocol} · Same region ({region})',
  'addPort.errPortRange': 'Port must be an integer between 1024 and 65535',
  'addPort.errPortOccupied': 'Local port {port} is already in use',
  'addPort.errSelectProfile': 'Please select a profile',
  'addPort.errSelectUpstream': 'Please select an upstream node for the chain',
  'addPort.errSelectNode': 'Please select a proxy node to bind',
  'addPort.errResidentialMissing':
    'Selected residential exit was deleted; please reselect or clear',
  'addPort.titleEdit': 'Edit Port Mapping',
  'addPort.titleQuickBind': 'Quick Bind to Port Listener',
  'addPort.titleAdd': 'Add Port Mapping',
  'addPort.subEditChain':
    'Modify inbound port, upstream node, and residential exit chain',
  'addPort.subAddChain':
    'Upstream → Residential Exit → Target; all traffic exits via residential proxy',
  'addPort.subEditNormal': 'Modify inbound port and 1:1 bound proxy node',
  'addPort.subAddNormal':
    'Assign a local inbound port and bind 1:1 to a proxy node',
  'addPort.saveChanges': 'Save Changes',
  'addPort.confirmCreate': 'Create',
  'addPort.driftChainAlert':
    'Upstream node or residential exit invalid (port will reject traffic)',
  'addPort.driftNormalAlert': 'Node drifted/invalid (DIRECT fallback active)',
  'addPort.suggestedMatch': 'Suggested match: ',
  'addPort.localPortLabel': 'Local Listen Port',
  'addPort.portAvailableTitle': 'Port available',
  'addPort.portAvailable': 'Available',
  'addPort.portOccupiedTitle': 'Port in use',
  'addPort.portOccupied': 'In use',
  'addPort.portHint': 'Recommended: 1024 ~ 65535 (e.g. 7891, 7892)',
  'addPort.protocolLabel': 'Inbound Protocol',
  'addPort.protocolHttp': 'HTTP Proxy',
  'addPort.protocolSocks5': 'SOCKS5 Proxy',
  'addPort.protocolHint': 'Mixed supports both HTTP and SOCKS5',
  'addPort.upstreamNodeLabel': 'Upstream Node (Chain Hop)',
  'addPort.bindNodeLabel': 'Bind Proxy Node',
  'addPort.noNodesPlaceholder':
    'No proxy nodes available; please add a profile first',
  'addPort.selectUpstreamPlaceholder': 'Search or select upstream node',
  'addPort.selectNodePlaceholder': 'Search or select proxy node to bind',
  'addPort.upstreamHint':
    'In chain mode, the upstream node acts as a hop and can be shared across ports; final exit is determined below.',
  'addPort.nodeSearchHint':
    'Single term matches node name; space-separated "profile node" filters both with fuzzy matching.',
  'addPort.residentialLabel': 'Residential Exit (Optional)',
  'addPort.noResidentialConfigured': 'No residential exits configured',
  'addPort.selectResidentialPlaceholder': 'Select residential proxy exit',
  'addPort.residentialEmptyHint':
    'Manage authenticated HTTP / SOCKS5 residential proxies under Profiles → Residential Exits.',
  'addPort.residentialChainHint':
    'Enabling chain mode routes all traffic via Upstream → Residential Exit → Target; Bypass CN, fallback, and rules are disabled.',
  'addPort.residentialChainBadge': '{protocol} Chain',
  'addPort.chainWillReject': 'Chain will reject traffic',
  'addPort.chainStrictDesc':
    'If upstream or residential exit fails, connections are rejected without DIRECT fallback. Existing fallback and rules will be cleared.',
  'addPort.willClearOnSave': 'Will clear on save: ',
  'addPort.clearRulesCount': ' {count} website routing rule(s)',
  'addPort.and': ' and ',
  'addPort.clearExistingFallback': ' existing fallback node',
  'addPort.fallbackLabel': 'Same-Region Fallback Node (Failover)',
  'addPort.fallbackRegionLimit': '{region} only',
  'addPort.thisRegion': 'this region',
  'addPort.noFallbackInRegion':
    'No other nodes available in {region} for same-region fallback.',
  'addPort.selectFallbackPlaceholder':
    'Select same-region fallback node (optional, cross-profile)',
  'addPort.fallbackHint':
    'Automatically fails over when primary times out, and recovers when primary is back.',
  'addPort.primaryShort': 'Pri',
  'addPort.fallbackShort': 'Fb',
  'addPort.swapPrimaryFallbackTitle': 'Swap primary and backup nodes',
  'addPort.swapBoundWarning':
    'Backup node "{node}" is already bound as primary on port {port}',
  'addPort.bypassCnChainDisabled':
    'Disabled in chain mode: all traffic exits via residential proxy',
  'addPort.bypassCnTitle': 'Smart Bypass Mainland China (Direct)',
  'addPort.bypassCnDesc':
    'Mainland China domains and IPs go direct without proxy',
  // Traffic Sniffer Panel
  'sniffer.residentialSuffix': '{name} · Residential',
  'sniffer.sandboxClosedToast': 'Sandbox closed; captured domains locked',
  'sniffer.sandboxDoneToast': 'Sandbox closed and domain capture completed',
  'sniffer.invalidUrlWarning':
    'Please enter a valid target URL or domain, e.g. ip.skk.moe',
  'sniffer.coreStoppedWarning':
    'Please start Mihomo core before traffic sniffing',
  'sniffer.sandboxLaunched':
    'Sandbox launched for {host} (exit :{port}). Close the window once loaded.',
  'sniffer.payloadsLabel':
    'Match Patterns (one domain, regex, or IP CIDR per line)',
  'sniffer.sniffingCount': 'Sniffing ({count})',
  'sniffer.title': 'Smart Traffic Sniffer',
  'sniffer.urlPlaceholder':
    'Enter target URL to launch sandbox sniffer (e.g. https://chatgpt.com)...',
  'sniffer.pageReadyTitle':
    'Sandbox page DOM and static assets loaded; you can close the sandbox anytime',
  'sniffer.pageLoadingTitle':
    'Sandbox browser is loading page resources and APIs...',
  'sniffer.pageReady': 'Page Ready',
  'sniffer.pageLoading': 'Loading...',
  'sniffer.closeSandboxTitle':
    'Close sandbox window and lock all captured domains',
  'sniffer.closeSandboxBtn': 'Done & Close',
  'sniffer.openSandboxTitle':
    'Launch incognito WebView sandbox via the selected test port',
  'sniffer.openSandboxBtn': 'Open Sandbox',
  'sniffer.modeRoot': 'Root Domains',
  'sniffer.modeFull': 'Full Subdomains',
  'sniffer.noEnabledPortPlaceholder': 'No enabled port available',
  'sniffer.isolatedExitPrefix': 'Isolated Exit :{port} (',
  'sniffer.clearTitle': 'Clear captured records',
  'sniffer.clearBtn': 'Clear',
  'sniffer.runningHint':
    'Sandbox running, capturing request chains in real time. Close the window when loaded...',
  'sniffer.idleHint':
    'Enter a URL above and click "Open Sandbox" to browse in an isolated WebView; close it when loaded to extract domains.',
  'sniffer.subdomainsCount': ' +{count} subdomains',
  'sniffer.alreadyInList': 'Already in list',
  'sniffer.matchedRuleTitle': 'Matched rule: {rule}',
  'sniffer.capturedPrefix': 'Captured ',
  'sniffer.capturedSuffix': ' domain(s)',
  'sniffer.readyToClose': 'Page ready, safe to close',
  'sniffer.captureDone': 'Capture complete',
  'sniffer.selectAll': 'Select All',
  'sniffer.deselectAll': 'Deselect All',
  'sniffer.appendSelected': 'Append Selected ({count})',
  // Port Rules Modal
  'rules.appendedDomains': 'Appended {count} domain(s) to match patterns',
  'rules.fromProfile': 'From profile: {name}',
  'rules.defaultProfile': 'Default Profile',
  'rules.portOptionLabel': 'Port {port} (Exit: {node})',
  'rules.portOptionDesc': 'Inbound: {protocol}{fallback}',
  'rules.portOptionFallback': ' · Auto-failover',
  'rules.etcShort': ' etc.',
  'rules.addedBadge': 'Added',
  'rules.testTimeout': 'Timed out',
  'rules.warnSelectTarget': 'Please select a target exit',
  'rules.warnSelectPreset': 'Please select a preset website/service',
  'rules.warnPresetExists': 'Rule "{name}" already exists',
  'rules.warnEnterPayload': 'Please enter at least one domain or match pattern',
  'rules.warnNameExists': 'Rule named "{name}" already exists',
  'rules.ruleAdded': 'Rule added: {name}',
  'rules.newRuleDefault': 'New Rule',
  'rules.ruleUpdated': 'Rule updated: {name}',
  'rules.ruleDefault': 'Routing Rule',
  'rules.chainUnsupported':
    'Residential chain ports do not support website routing rules. Unbind the residential exit first.',
  'rules.globalSaved': 'Global website routing rules saved and applied',
  'rules.localSaved': 'Website routing rules saved and applied',
  'rules.saveFailed': 'Save failed: {err}',
  'rules.globalTitle': 'Global Website Routing Rules',
  'rules.localTitle': 'Port {port} Website Routing Rules',
  'rules.globalSubtitle':
    'Applies to standard proxy ports (chain ports always use residential exit) · {count} global rule(s)',
  'rules.localSubtitle': 'Default exit: {node} · {count} local rule(s)',
  'rules.addRuleBtn': 'Add Routing Rule',
  'rules.saveAndApply': 'Save & Apply',
  'rules.emptyGlobalTitle': 'No global website routing rules',
  'rules.emptyLocalTitle': 'No port-specific routing rules',
  'rules.emptyGlobalDesc':
    'Global rules route matching websites (e.g. Gemini, OpenAI, YouTube) on all standard proxy ports. Local port rules take higher priority. Residential chain ports ignore routing rules.',
  'rules.emptyLocalDesc':
    'By default, all traffic exits via {node} (or inherits {count} active global rule(s)). Local rules override global rules for this port.',
  'rules.addFirstRuleBtn': 'Add First Routing Rule',
  'rules.directEgressText': 'DIRECT',
  'rules.portEgressText': 'Port {port}',
  'rules.targetPrefix': 'Route:',
  'rules.itemsCount': '{count} item(s) · ',
  'rules.editRuleTitle': 'Edit rule',
  'rules.deleteRuleTitle': 'Delete rule',
  'rules.editGlobalTitle': 'Edit Global Routing Rule',
  'rules.editLocalTitle': 'Edit Port {port} Routing Rule',
  'rules.addGlobalTitle': 'Add Global Routing Rule',
  'rules.addLocalTitle': 'Add Routing Rule for Port {port}',
  'rules.editSubtitle': 'Adjust rule configuration and target exit',
  'rules.addGlobalSubtitle':
    'Configure target exit for matching websites globally',
  'rules.addLocalSubtitle':
    'Configure target exit for matching websites on port {port}',
  'rules.backToList': 'Back to List',
  'rules.confirmAddRule': 'Add Rule',
  'rules.tabPreset': 'Preset Services',
  'rules.tabCustom': 'Custom Rule',
  'rules.ruleTypeLabel': 'Rule Type:',
  'rules.presetServiceLabel': 'Preset Website / Service',
  'rules.presetServiceFallback': 'Preset Service',
  'rules.presetSearchPlaceholder':
    'Search or select a service (by name, domain, or category)',
  'rules.presetDomainsLabel': '{name} included domains ({count}):',
  'rules.customNameLabel': 'Rule Name',
  'rules.customNamePlaceholder': 'e.g. Personal Blog / Internal API',
  'rules.matchTypeLabel': 'Match Type',
  'rules.matchDomainSuffix': 'Domain Suffix (DOMAIN-SUFFIX)',
  'rules.matchDomain': 'Exact Domain (DOMAIN)',
  'rules.matchDomainRegex': 'Regex (DOMAIN-REGEX)',
  'rules.matchDomainKeyword': 'Keyword (DOMAIN-KEYWORD)',
  'rules.matchIpCidr': 'IP CIDR (IP-CIDR)',
  'rules.bindTargetLabel': 'Bind target exit for this rule:',
  'rules.targetNode': 'Proxy Node',
  'rules.targetPort': 'Other Port',
  'rules.targetDirect': 'DIRECT',
  'rules.selectNodePlaceholder': 'Select proxy node',
  'rules.selectPortPlaceholder': 'Select port',
  'rules.directPublicLabel': 'DIRECT (No Proxy)',
  'rules.testBtnSelectSiteFirst':
    'Please select or enter a target website above first',
  'rules.testBtnTitle':
    'Test actual handshake latency to {site} via current exit',
  'rules.testingBtn': 'Testing...',
  'rules.testBtn': 'Test Site',
  'rules.testLatencyLabel': 'Latency:',
  'rules.testExitSuffix': '(Exit: {node})',
  'rules.testHintNoSite': 'Select a target website above to test latency',
  'rules.testHintReady':
    'Click Test Site to probe actual latency via current exit (timeout {timeout}ms)',
  // Edit Direct Port Modal
  'directPort.defaultDesc': 'Direct listener (traffic bypasses proxy)',
  'directPort.updatedToast': 'Direct listener port updated to {port}',
  'directPort.title': 'Edit Direct Listener Port',
  'directPort.subtitle':
    'Customize local direct listener port and inbound protocol',
  'directPort.saveConfig': 'Save Config',
  'directPort.infoTitle': 'About Direct Listener',
  'directPort.infoDesc':
    'Traffic on this port goes directly to the internet without any proxy. Useful for browser extensions (e.g. SwitchyOmega) when system proxy is enabled.',
  'directPort.portHint': 'Recommended: 7878 (range 1024 ~ 65535)',
  'directPort.protocolHint': 'Mixed is recommended for both HTTP & SOCKS5',
  'directPort.descLabel': 'Card Description',

  // Quick Copy Menu
  'quickCopy.envCmdPs': 'Terminal Env Vars (PowerShell)',
  'quickCopy.envCmdShell': 'Terminal Env Vars (Shell export)',
  'quickCopy.envDescShell': 'export http_proxy=... (upper & lower case)',
  'quickCopy.hostPortLabel': 'Address (Host:Port)',
  'quickCopy.httpUrlLabel': 'HTTP Proxy URL',
  'quickCopy.socks5UrlLabel': 'SOCKS5 Proxy URL',
  'quickCopy.curlLabel': 'cURL Egress IP Probe',
  'quickCopy.curlDesc': 'Test this port egress IP in terminal',
  'quickCopy.copiedToast': 'Copied {label}: {val}',
  'quickCopy.disabledTitle': 'Port disabled; cannot copy or configure proxy',
  'quickCopy.envActiveTitle':
    'Active global terminal proxy (click to manage/copy)',
  'quickCopy.defaultTitle': 'Terminal Proxy & Quick Copy',
  'quickCopy.menuHeader': 'Quick Copy Proxy Format',
  'quickCopy.envSection': 'Terminal Env Vars',
  'quickCopy.currentExit': 'Active',
  'quickCopy.envActiveDesc': 'Active in new terminals',
  'quickCopy.envInactiveDesc': 'Inject into system env vars',
  'quickCopy.unbind': 'Unbind',
  'quickCopy.bind': 'Bind',
  // HoverStepSlider
  'stepSlider.disabled': 'Disabled',
  'stepSlider.listening': 'Listen',
  'stepSlider.systemProxy': 'System Proxy',
  'stepSlider.off': 'Off',
  'stepSlider.lockedDefault': 'Direct listener cannot be set as system proxy',
  'stepSlider.currentStateTitle': 'Current: {label} (hover to adjust)',
  'stepSlider.listenState': 'Listen State',
  'addPort.descriptionLabel': 'Description (Optional)',
  'addPort.descriptionPlaceholder': 'e.g. Fingerprint Browser #01',
  'settings.appearance.title': 'Appearance & Personalization',
  'settings.appearance.desc':
    'Customize theme, acrylic glass effect, and background wallpaper',
  'settings.theme.title': 'Theme',
  'settings.theme.desc': 'Choose light, dark, or follow system appearance',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'System',
  // App Events
  'app.profileUpdatedWithDrift':
    'Profile "{name}" updated ({count} nodes). Detected {drifted} drifted port(s) and enabled DIRECT fallback.',
  'app.profileUpdatedWithDriftTitle': 'Profile Update & Drift Protection',
  'app.profileUpdated':
    'Profile "{name}" updated with {count} available nodes.',
  'header.coreStopped': 'Core Stopped',
  'header.startCore': 'Start Core',
  'header.stopCore': 'Stop Core',
  'header.restartCore': 'Restart Core',
  'header.uptime': 'Uptime',

  // Settings - Language
  'settings.language.title': 'Language',
  'settings.language.desc': 'Switch application display language',
  'settings.language.system': 'System',
  'settings.language.zhCN': '简体中文',
  'settings.language.enUS': 'English',

  // Proxy Nodes (ProxyGridView)
  'proxies.detectingIpTitle': 'Detecting egress IP...',
  'proxies.copyIpTitle': 'Click to copy node egress IP: {ip}{region}',
  'proxies.detectIpTitle': 'Click to detect and copy node egress IP',
  'proxies.detectingIp': 'Detecting',
  'proxies.copyIp': 'Copy IP',
  'proxies.testingTitle': 'Testing latency...',
  'proxies.testSingleTitle': 'Click to test latency',
  'proxies.boundPortTitle': 'Bound to local inbound port {port}',
  'proxies.bindPortTitle': 'Bind to local inbound port',
  'proxies.bind': 'Bind',
  'proxies.copiedIpToast': 'Copied node egress IP: {ip}{region}',
  'proxies.detectIpFailed': 'Failed to detect egress IP: {err}',
  'proxies.goToSettings': 'Go to Settings',
  'proxies.searchPlaceholder': 'Search node name, region, protocol...',
  'proxies.selectProfilePlaceholder': 'Select profiles...',
  'proxies.noProfileSelected': 'No profile selected',
  'proxies.allProfiles': 'All Profiles ({count})',
  'proxies.oneProfileSelected': '1 profile selected',
  'proxies.nProfilesSelected': '{count} profiles selected',
  'proxies.sortDefault': 'Default',
  'proxies.sortLatencyAsc': 'Latency ↑',
  'proxies.sortLatencyDesc': 'Latency ↓',
  'proxies.sortNameAsc': 'Name (A-Z)',
  'proxies.testingAll': 'Testing all...',
  'proxies.testAll': 'Test All',
  'proxies.testVisible': 'Test visible items',
  'proxies.regionLabel': 'Region:',
  'proxies.allCount': 'All ({count})',
  'proxies.protocolLabel': 'Protocol:',
  'proxies.emptyNoProfileTitle': 'No Profile Selected',
  'proxies.emptyNoProfileDesc':
    'Please select one or more profiles from the dropdown above.',
  'proxies.selectAllProfiles': 'Select All Profiles',
  'proxies.emptyNoNodesTitle': 'No Proxy Nodes Available',
  'proxies.emptyNoNodesDesc':
    'Go to Profiles to import a remote subscription URL or local Clash YAML file.',
  'proxies.goToProfiles': 'Go to Profiles',
  'proxies.emptyNoMatch': 'No proxy nodes match the current filters',
  'proxies.resetFilters': 'Reset All Filters',

  // MultiSelect
  'multiSelect.placeholder': 'Select...',
  'multiSelect.selectAll': 'All',
  'multiSelect.clearAll': 'Clear',
  'multiSelect.invert': 'Invert',
  'multiSelect.noData': 'No matching options',
  'multiSelect.allCount': 'All ({count})',
  'multiSelect.selectedCount': '{count} selected',
  'multiSelect.searchPlaceholder': 'Search...',
  'multiSelect.clearSearch': 'Clear search',
  'multiSelect.selectedRatio': '{selected}/{total}',

  // Profile Main (profile list and profile modals)
  'profileMain.importedProfilesLabel': 'Imported profiles:',
  'profileMain.totalNodesLabel': 'Total nodes:',
  'profileMain.residentialExits': 'Residential exits',
  'profileMain.residentialExitsTitle':
    'Manage authenticated residential proxy exits used by port chains',
  'profileMain.refreshAllTitle': 'Refresh all profiles',
  'profileMain.noProfilesTitle': 'No profiles yet',
  'profileMain.refreshing': 'Refreshing...',
  'profileMain.refreshAll': 'Refresh all',
  'profileMain.importLocalYaml': 'Import local YAML',
  'profileMain.addRemote': 'Add remote profile',
  'profileMain.loadingList': 'Loading profiles...',
  'profileMain.emptyTitle': 'No profiles added yet',
  'profileMain.emptyDesc':
    'Supports standard Clash / Mihomo subscription URLs and local config files containing proxies. Nodes are parsed automatically with optional scheduled silent updates.',
  'profileMain.emptyCta': 'Add a remote profile now',
  'profileMain.typeRemote': 'Remote profile',
  'profileMain.typeLocal': 'Local file',
  'profileMain.nodeCount': '{count} nodes',
  'profileMain.copyLinkTitle': 'Copy link or file path',
  'profileMain.viewNodes': 'View nodes ({count})',
  'profileMain.revealFileTitle': 'Show this profile file in the file explorer',
  'profileMain.editProfileTitle': 'Edit profile',
  'profileMain.refreshProfileTitle': 'Refresh / re-fetch profile',
  'profileMain.updating': 'Updating',
  'profileMain.deleteProfileTitle': 'Delete profile',
  'profileMain.deleteModalTitle': 'Delete this profile?',
  'profileMain.deleteModalSubtitle':
    'This permanently removes the profile and all of its cached nodes',
  'profileMain.deleteNodeCount': 'Contains {count} nodes',
  'profileMain.confirmDelete': 'Delete',
  'profileMain.neverUpdated': 'Never updated',
  'profileMain.intervalManual': 'Manual update',
  'profileMain.intervalEveryMinutes': 'Every {count} min',
  'profileMain.intervalEveryHours': 'Every {count} h',
  'profileMain.intervalEveryDays': 'Every {count} d',
  'profileMain.intervalOptionManualOnly':
    'No auto update (manual refresh only)',
  'profileMain.intervalOptionMinutes': 'Auto update every {count} minutes',
  'profileMain.intervalOptionHours': 'Auto update every {count} hours',
  'profileMain.intervalOptionDays': 'Auto update every {count} days',
  'profileMain.errConfigNameRequired': 'Please enter a config name',
  'profileMain.errProfileNameRequired': 'Please enter a profile name',
  'profileMain.errLocalPathRequired':
    'Please enter the absolute path of the local YAML file',
  'profileMain.errUrlInvalid':
    'Please enter a valid http:// or https:// subscription URL',
  'profileMain.addLocalTitle': 'Import local YAML profile',
  'profileMain.addLocalSubtitle':
    'Copy a local Clash config file and parse its nodes',
  'profileMain.importing': 'Importing...',
  'profileMain.confirmImport': 'Import',
  'profileMain.configNameLabel': 'Config name',
  'profileMain.configNamePlaceholder': 'e.g. Local backup nodes',
  'profileMain.filePathLabel': 'Absolute file path',
  'profileMain.filePathPlaceholder':
    'e.g. C:\\Users\\Desktop\\clash_config.yaml',
  'profileMain.browse': 'Browse...',
  'profileMain.filePathHint':
    'The file will be copied and its proxies node pool extracted',
  'profileMain.addRemoteTitle': 'Add remote profile',
  'profileMain.addRemoteSubtitle':
    'Import a standard Clash / Mihomo subscription URL',
  'profileMain.fetching': 'Fetching and parsing...',
  'profileMain.confirmAdd': 'Add',
  'profileMain.profileNameLabel': 'Profile name',
  'profileMain.profileNamePlaceholder': 'e.g. Primary provider nodes',
  'profileMain.urlLabel': 'Subscription URL',
  'profileMain.urlHelper':
    'Requests automatically carry a standard Clash User-Agent for compatibility',
  'profileMain.autoUpdateInterval': 'Auto update interval',
  'profileMain.saveChanges': 'Save changes',
  'profileMain.localFilePath': 'Local config file path',
  'profileMain.toastRemoteAdded':
    'Remote profile "{name}" was added and parsed successfully',
  'profileMain.toastLocalImported':
    'Local config "{name}" was imported successfully',
  'profileMain.toastUpdated': 'Profile "{name}" was updated successfully',
  'profileMain.toastRefreshed':
    'Profile "{name}" was refreshed with {count} nodes',
  'profileMain.toastRefreshFailed': 'Refresh failed: {error}',
  'profileMain.toastRefreshAllSuccess':
    'Successfully refreshed all {count} profiles',
  'profileMain.toastRefreshAllFailed':
    'All {count} profiles failed to refresh. Check the network or configs',
  'profileMain.toastRefreshAllPartial':
    'Refresh complete: {success} succeeded, {failed} failed',
  'profileMain.toastCopied': 'Link/path copied to clipboard',
  'profileMain.toastCopyFailed': 'Copy failed, please copy manually',
  'profileMain.toastOpenFolderFailed':
    'Failed to open the containing folder: {error}',
  'profileMain.toastDeleted': 'Profile "{name}" was deleted',
  'profileMain.toastDeleteFailed': 'Delete failed: {error}',
  'profileMain.remainingTraffic': '{amount} left',
  'profileMain.remainingOfTotal': '{remaining} / {total} left',
  'profileMain.usedTraffic': '{used} used',
  'profileMain.expireNever': 'Never expires',
  'profileMain.expired': 'Expired',
  'profileMain.expireOn': 'Expires {date}',
  'profileMain.expireDaysLeft': '{days}d left',
  'profileMain.resetInDays': 'Resets in {days}d',
  'profileMain.tooltipTitle': 'Profile: {name}',
  'profileMain.tooltipRemaining': 'Remaining',
  'profileMain.tooltipUsed': 'Used',
  'profileMain.tooltipTotal': 'Total',
  'profileMain.tooltipExpiry': 'Expires',
  'profileMain.tooltipReset': 'Reset',
  'profileMain.tooltipNodes': 'Nodes',
  'profileMain.tooltipNoQuota': 'No traffic or expiry info',

  // Residential Proxy i18n (ProfileNodesModal / ResidentialProxyManager / ResidentialProxyTestPanel)
  'residentialI18n.common.close': 'Close',
  'residentialI18n.common.cancel': 'Cancel',
  'residentialI18n.common.retry': 'Retry',
  'residentialI18n.common.loadConfigFailed':
    'Failed to load the configuration, please retry',

  'residentialI18n.nodes.title': '{name} — Node List',
  'residentialI18n.nodes.subtitle': '{count} available proxy nodes parsed',
  'residentialI18n.nodes.footer': 'Showing {shown} / {total} nodes',
  'residentialI18n.nodes.searchPlaceholder':
    'Search node name, protocol, or server address...',
  'residentialI18n.nodes.loading': 'Reading and parsing nodes...',
  'residentialI18n.nodes.emptyNoNodes':
    'This profile contains no proxies entries.',
  'residentialI18n.nodes.emptyNoMatch': 'No matching nodes found.',
  'residentialI18n.nodes.probingTitle': 'Detecting egress IP...',
  'residentialI18n.nodes.copyIpTitle':
    'Click to copy node egress IP: {ip}{region}',
  'residentialI18n.nodes.detectIpTitle':
    'Click to detect and copy this node\u2019s egress IP',
  'residentialI18n.nodes.probing': 'Detecting',
  'residentialI18n.nodes.copyIp': 'Copy IP',
  'residentialI18n.nodes.copiedToast': 'Copied node egress IP: {ip}{region}',
  'residentialI18n.nodes.detectFailed': 'Failed to detect egress IP: {err}',

  'residentialI18n.manager.titleEditor': 'Residential Exit Settings',
  'residentialI18n.manager.titleList': 'Residential Exit Management',
  'residentialI18n.manager.subtitleEditor':
    'Authenticated HTTP / SOCKS5 residential proxy, stored only in local config',
  'residentialI18n.manager.subtitleList':
    'Residential exits used by port chains · {count} configured',
  'residentialI18n.manager.desktopOnlyNotice':
    'You are in the browser preview, so residential exits cannot be saved to the desktop backend. Use the desktop app for this feature.',
  'residentialI18n.manager.loadingConfig':
    'Loading residential exit configuration...',
  'residentialI18n.manager.emptyTitle': 'No residential exits configured',
  'residentialI18n.manager.emptyDesc':
    'Add an authenticated HTTP / SOCKS5 residential proxy, then select it in a port mapping to build a fixed upstream node → residential exit → target chain.',
  'residentialI18n.manager.addFirst': 'Add First Residential Exit',
  'residentialI18n.manager.addExit': 'Add Residential Exit',
  'residentialI18n.manager.backToList': 'Back to List',
  'residentialI18n.manager.saveChanges': 'Save Changes',
  'residentialI18n.manager.nameLabel': 'Name',
  'residentialI18n.manager.namePlaceholder': 'e.g. US Static Residential 01',
  'residentialI18n.manager.nameRequired':
    'Please enter a residential exit name',
  'residentialI18n.manager.serverLabel': 'Server Address',
  'residentialI18n.manager.serverPlaceholder':
    'gate.example.com or 203.0.113.10',
  'residentialI18n.manager.serverRequired':
    'Please enter the residential proxy server address',
  'residentialI18n.manager.serverInvalid':
    'Enter only a host name or IP, without protocol prefix, path, or spaces',
  'residentialI18n.manager.portLabel': 'Port',
  'residentialI18n.manager.portInvalid':
    'Residential proxy port must be an integer between 1 and 65535',
  'residentialI18n.manager.protocolLabel': 'Proxy Protocol',
  'residentialI18n.manager.usernameLabel': 'Username (optional)',
  'residentialI18n.manager.usernamePlaceholder': 'username',
  'residentialI18n.manager.passwordLabel': 'Password (optional)',
  'residentialI18n.manager.passwordPlaceholder': 'password',
  'residentialI18n.manager.showPassword': 'Show password',
  'residentialI18n.manager.hidePassword': 'Hide password',
  'residentialI18n.manager.credentialsHint':
    'Fill in both username and password, or leave both empty; credentials are written only to the local config file and never uploaded.',
  'residentialI18n.manager.credentialsPair':
    'Residential proxy username and password must both be filled in or both left empty',
  'residentialI18n.manager.chainNotePrefix':
    'Ports bound to this exit are forced through',
  'residentialI18n.manager.chainNoteStrong':
    'upstream node → residential exit → target',
  'residentialI18n.manager.chainNoteSuffix':
    '. Bypass CN, fallback nodes, and rule-based routing are disabled; if the upstream node is unavailable the port rejects connections instead of falling back to direct.',
  'residentialI18n.manager.createdToast': 'Residential exit "{name}" added',
  'residentialI18n.manager.updatedToast': 'Residential exit "{name}" updated',
  'residentialI18n.manager.deletedToast': 'Residential exit "{name}" deleted',
  'residentialI18n.manager.deleteFailed': 'Delete failed: {err}',
  'residentialI18n.manager.usedByPortsTitle': 'In use by ports {ports}',
  'residentialI18n.manager.portsInUse': '{count} port(s) in use',
  'residentialI18n.manager.unused': 'Unused',
  'residentialI18n.manager.credentialConfigured': 'Credentials configured',
  'residentialI18n.manager.authConfigured': 'Authenticated',
  'residentialI18n.manager.noAuth': 'No authentication',
  'residentialI18n.manager.portsList': 'Ports {ports}',
  'residentialI18n.manager.confirmDelete': 'Confirm Delete',
  'residentialI18n.manager.testChainTitle':
    'Test the actual chain egress with saved credentials',
  'residentialI18n.manager.collapseTest': 'Hide Test',
  'residentialI18n.manager.testConnection': 'Test Connection',
  'residentialI18n.manager.editAria': 'Edit residential exit {name}',
  'residentialI18n.manager.editTitle': 'Edit residential exit',
  'residentialI18n.manager.deleteAria': 'Delete residential exit {name}',
  'residentialI18n.manager.deleteBlockedTitle':
    'In use by ports {ports}; unbind them first',
  'residentialI18n.manager.deleteTitle': 'Delete residential exit',
  'residentialI18n.manager.desktopOnly': 'Desktop app only',
  'residentialI18n.manager.referencedNote':
    'Residential exits referenced by ports cannot be deleted; unbind them from those ports first.',

  'residentialI18n.test.nodeCount': '{count} nodes',
  'residentialI18n.test.desktopRequired':
    'Residential exit testing requires the desktop app (Mihomo core)',
  'residentialI18n.test.selectFirst':
    'Select a profile and upstream node before testing',
  'residentialI18n.test.passedToast':
    'Residential exit test passed: {ip} · {latency} ms',
  'residentialI18n.test.liveFailed': 'Residential exit test failed: {err}',
  'residentialI18n.test.liveProfilesFailed': 'Failed to load profiles: {err}',
  'residentialI18n.test.liveNodesFailed': 'Failed to load nodes: {err}',
  'residentialI18n.test.livePassed':
    'Residential exit test passed: {ip}, {region}, {latency} ms',
  'residentialI18n.test.previewNote':
    'Residential exit testing is only supported in the desktop app; the browser preview makes no real connections.',
  'residentialI18n.test.profileLabel': 'Profile',
  'residentialI18n.test.profileAria': 'Profile for the residential exit test',
  'residentialI18n.test.loadingProfiles': 'Loading profiles...',
  'residentialI18n.test.profilesLoadFailed': 'Failed to load profiles',
  'residentialI18n.test.profilesLoadFailedWith':
    'Failed to load profiles: {err}',
  'residentialI18n.test.noProfiles': 'No profiles',
  'residentialI18n.test.selectProfile': 'Select a profile',
  'residentialI18n.test.nodeLabel': 'Upstream Node',
  'residentialI18n.test.nodeAria':
    'Upstream node for the residential exit test',
  'residentialI18n.test.selectProfileFirst': 'Select a profile first',
  'residentialI18n.test.loadingNodes': 'Loading nodes...',
  'residentialI18n.test.nodesLoadFailed': 'Failed to load nodes',
  'residentialI18n.test.nodesLoadFailedWith': 'Failed to load nodes: {err}',
  'residentialI18n.test.noNodes': 'No nodes in this profile',
  'residentialI18n.test.selectNode': 'Select an upstream node',
  'residentialI18n.test.chainNote':
    'Actual path: selected upstream node → saved residential exit ({protocol} {server}:{port}) → target. Saved credentials are used; save changes before re-testing.',
  'residentialI18n.test.testingNote':
    'Connecting to the residential exit through the upstream node...',
  'residentialI18n.test.passed': 'Test passed',
  'residentialI18n.test.testConnection': 'Test Connection',
  'residentialI18n.test.otherRegion': 'Other regions',
  'connections.closed': 'Connection closed',
  'connections.closeFailed': 'Failed to close connection: {error}',
  'connections.allClosed': 'All connections closed',
  'connections.closeAllFailed': 'Failed to close all connections: {error}',
  'connections.active': 'Active connections',
  'connections.countUnit': '',
  'connections.liveSpeed': 'Live total speed',
  'connections.totalDownload': 'Total downloaded',
  'connections.totalUpload': 'Total uploaded',
  'connections.search': 'Search host / IP / process / node...',
  'connections.allPorts': 'All ports',
  'connections.port': 'Port {port}',
  'connections.allProtocols': 'All',
  'connections.sortSpeed': 'By speed ↓',
  'connections.sortTraffic': 'By traffic ↓',
  'connections.sortDuration': 'By duration ↓',
  'connections.resumeRefresh': 'Resume auto-refresh',
  'connections.pauseRefresh': 'Pause auto-refresh',
  'connections.resume': 'Resume',
  'connections.pause': 'Pause',
  'connections.refreshNow': 'Refresh now',
  'connections.closeAll': 'Close all connections',
  'connections.closeAllShort': 'Close all',
  'connections.coreStopped': 'Mihomo core is not running',
  'connections.startCore':
    'Start the proxy core from the main screen or settings to view live connections',
  'connections.noMatches': 'No matching active connections',
  'connections.clearFilters': 'Clear filters to view all connections',
  'connections.awaitTraffic':
    'Connections appear here when traffic passes through a listener',
  'connections.destination': 'Destination',
  'connections.inboundPort': 'Inbound port',
  'connections.outboundChain': 'Exit node / chain',
  'connections.ruleProcess': 'Rule / process',
  'connections.liveSpeedShort': 'Live speed',
  'connections.totalTraffic': 'Total traffic',
  'connections.duration': 'Duration',
  'connections.actions': 'Actions',
  'connections.viewDetails': 'View connection details',
  'connections.closeConnection': 'Close connection',
  'connections.details': 'Connection details',
  'connections.close': 'Close',
  'connections.host': 'Destination host',
  'connections.default': 'Default',
  'connections.networkType': 'Network and type',
  'connections.startedAt': '(started at {time})',
  'connections.liveDownload': 'Download speed',
  'connections.liveUpload': 'Upload speed',
  'connections.downloaded': 'Downloaded',
  'connections.uploaded': 'Uploaded',
  'connections.metadata': 'Network and routing metadata',
  'connections.id': 'Connection ID',
  'connections.source': 'Source address',
  'connections.destinationIp': 'Destination IP',
  'connections.sniffHost': 'Sniffed host',
  'connections.dnsMode': 'DNS mode',
  'connections.matchedRule': 'Matched rule',
  'connections.proxyChain': 'Proxy chain',
  'connections.process': 'Process',
  'connections.processPath': 'Process path',
  'connections.confirmCloseAll': 'Close all connections?',
  'connections.cancel': 'Cancel',
  'connections.confirmClose': 'Confirm',
  'connections.closeAllDescription':
    'Close all active connections? All ongoing TCP/UDP connections will be terminated immediately.',
  'settingsUwp.title': 'UWP app list & loopback exemption status',
  'settingsUwp.subtitle':
    'Detected {total} UWP app containers: {exempted} exempted, {unexempted} not exempted',
  'settingsUwp.refreshed': 'UWP app list refreshed',
  'settingsUwp.loadFailed': 'Failed to get UWP app list',
  'settingsUwp.copySidToast': 'SID copied to clipboard',
  'settingsUwp.copyFailed': 'Copy failed',
  'settingsUwp.footerCount': 'Showing {shown} of {total} apps',
  'settingsUwp.close': 'Close',
  'settingsUwp.searchPlaceholder':
    'Search app name, package identity or SID...',
  'settingsUwp.filterAll': 'All ({count})',
  'settingsUwp.filterExempted': 'Exempted ({count})',
  'settingsUwp.filterUnexempted': 'Not exempted ({count})',
  'settingsUwp.refreshTitle': 'Refresh list',
  'settingsUwp.loading': 'Reading system UWP apps and exemption status...',
  'settingsUwp.emptyNoApps': 'No UWP app container registry entries found',
  'settingsUwp.emptyNoMatch': 'No matching UWP apps found',
  'settingsUwp.copySidTitle': 'Copy SID',
  'settingsUwp.statusExempted': 'Exempted',
  'settingsUwp.statusUnexempted': 'Not exempted',
  'settingsUpdate.appAvailable':
    'Version v{version} is available. Go to Settings → About & Updates to view and download it.',
  'settingsUpdate.appTitle': 'New version available',
  'settingsUpdate.kernelAvailable':
    'Mihomo core version {version} is available in Settings.',
  'settingsUpdate.kernelTitle': 'Core update available',
  'settingsUpdate.goNow': 'Open settings',
  'settingsPage.common.listSeparator': ', ',

  'settingsPage.core.title': 'Mihomo Core & Network',
  'settingsPage.core.desc':
    'Supervises the child process lifecycle and network listener communication',
  'settingsPage.core.stop': 'Stop Core',
  'settingsPage.core.start': 'Start Core',
  'settingsPage.core.restart': 'Restart',
  'settingsPage.core.statusLabel': 'Status',
  'settingsPage.core.runningActive': 'Running (Active)',
  'settingsPage.core.stopped': 'Stopped',
  'settingsPage.core.pid': 'Process PID',
  'settingsPage.core.restApi': 'External Controller (REST API)',
  'settingsPage.core.uptime': 'Uptime',
  'settingsPage.core.versionLabel': 'Mihomo Core Version',
  'settingsPage.core.installModePortable': 'Portable Mode (.portable)',
  'settingsPage.core.installModeDev': 'Development Mode (running core)',
  'settingsPage.core.installModeInstall': 'Installed Mode (AppData)',
  'settingsPage.core.unknownVersion': 'Mihomo Core (Unknown Version)',
  'settingsPage.core.none': 'N/A',
  'settingsPage.core.checkingUpdate': 'Checking...',
  'settingsPage.core.checkUpdate': 'Check Kernel Update',
  'settingsPage.core.updateFound': 'New version available: {version}',
  'settingsPage.core.updateDesc':
    'Downloads and replaces the core binary, then reloads automatically.',
  'settingsPage.core.targetPath': 'Target path: {path}',
  'settingsPage.core.releaseNotes': 'Release Notes',
  'settingsPage.core.updating': 'Updating...',
  'settingsPage.core.updateNow': 'Update Kernel Now',
  'settingsPage.core.mrsTitle': 'China Routing Rules (MRS Binary)',
  'settingsPage.core.mrsReady': 'Ready (4/4)',
  'settingsPage.core.mrsMissing': 'Missing {count} file(s)',
  'settingsPage.core.mrsDesc':
    'Contains 111,004 China domains and complete China IP CIDRs. Compact Meta rule-set format for fast matching with minimal memory.',
  'settingsPage.core.mrsLastUpdated': 'Last updated: {time}',
  'settingsPage.core.mrsBundled': 'Bundled with installer',
  'settingsPage.core.mrsSize': 'Size: {size} KB',
  'settingsPage.core.updatingRules': 'Updating rules...',
  'settingsPage.core.updateRules': 'Update Rule Set Now',
  'settingsPage.core.portLabel': 'External Controller Port',
  'settingsPage.core.portDesc':
    'Mihomo local RESTful control API port for hot reload and latency tests (default {port})',
  'settingsPage.core.portRangeError':
    'Port must be an integer between 1024 and 65535',
  'settingsPage.core.portNeedsRestart':
    'Port changed to {port}; restart the core to apply',
  'settingsPage.core.logLevelLabel': 'Core Log Level',
  'settingsPage.core.logLevelDesc':
    'Mihomo runtime log verbosity (hot-reloaded immediately)',
  'settingsPage.core.logLevel.info': 'Info (Standard)',
  'settingsPage.core.logLevel.warning': 'Warning',
  'settingsPage.core.logLevel.error': 'Error (Errors only)',
  'settingsPage.core.logLevel.debug': 'Debug (Verbose)',
  'settingsPage.core.logLevel.silent': 'Silent',
  'settingsPage.core.allowLanLabel': 'Allow LAN Connections',
  'settingsPage.core.allowLanDesc':
    'When enabled, port mappings listen on all interfaces (0.0.0.0), allowing LAN or VM devices to connect; when disabled, only localhost (127.0.0.1) is used.',
  'settingsPage.core.probeTitle': 'Node Probing & Fallback Strategy',
  'settingsPage.core.testUrlLabel': 'Probe & Latency Test URL',
  'settingsPage.core.testUrlDesc':
    'Endpoint used for global latency tests, per-port tests, and fallback health checks',
  'settingsPage.core.timeoutLabel': 'Node Test & Failure Timeout',
  'settingsPage.core.timeoutDesc':
    'Controls manual latency-test timeout and the fallback primary-node failure threshold (ms)',
  'settingsPage.core.fallbackIntervalLabel': 'Fallback Health Check Interval',
  'settingsPage.core.fallbackIntervalDesc':
    'Interval in seconds between Mihomo core probe checks; the core switches back automatically when the primary recovers',
  'settingsPage.core.secondsShort': 's',
  'settingsPage.core.lazyLabel': 'Lazy Health Check',
  'settingsPage.core.lazyDesc':
    'Applies only to ports with a fallback node. When off, the core probes continuously; when on, checks run only while traffic passes through the port.',

  'settingsPage.proxy.title': 'System Proxy',
  'settingsPage.proxy.desc':
    'Takes over the Windows WinInet global proxy; one listening port at a time, applies to desktop browsers and system apps',
  'settingsPage.proxy.enableLabel': 'Enable System Proxy',
  'settingsPage.proxy.enableDesc':
    'Sets the selected listening port as the global system proxy. Automatically cleaned up when the core stops or the app exits to prevent network loss',
  'settingsPage.proxy.portLabel': 'Outbound Listening Port',
  'settingsPage.proxy.portDesc':
    'Select an enabled listening port as the global egress (shared by system proxy and TUN mode)',
  'settingsPage.proxy.noPort':
    'No proxy port available. Enable a proxy port in port management first.',
  'settingsPage.proxy.portOption': 'Port {port} ({protocol} - {node})',
  'settingsPage.proxy.bypassLabel': 'Excluded Domains & IPs',
  'settingsPage.proxy.bypassDesc':
    'Requests matching this list connect directly without the system proxy. If env-var sync is enabled, they are also injected into the system no_proxy variable',
  'settingsPage.proxy.bypassPlaceholder':
    'Enter an excluded domain or IP (e.g. sheepyu.top, *.sheepyu.top, 119.29.106.76)...',
  'settingsPage.proxy.add': 'Add',
  'settingsPage.proxy.customBypassCount': 'Custom exclusions ({count}):',
  'settingsPage.proxy.removeBypass': 'Remove this exclusion',
  'settingsPage.proxy.defaultBypass':
    'Built-in exclusions (LAN and localhost):',
  'settingsPage.proxy.uwpLabel': 'UWP Loopback Exemption',
  'settingsPage.proxy.uwpBadge': '{exempted} of {total} apps exempted',
  'settingsPage.proxy.uwpAutoTitle':
    'Auto-exempt is on: newly installed UWP apps are added automatically; click "Clear All" to stop',
  'settingsPage.proxy.uwpAutoBadge': 'Auto-exempt new apps',
  'settingsPage.proxy.uwpDesc':
    'Removes Windows sandbox isolation from local proxy ports so Microsoft Store and UWP apps can connect through the system proxy',
  'settingsPage.proxy.uwpClear': 'Clear All',
  'settingsPage.proxy.uwpExempt': 'Exempt All',
  'settingsPage.proxy.uwpViewTitle': 'View UWP app list',
  'settingsPage.proxy.uwpRefreshTitle': 'Refresh exemption status',

  'settingsPage.env.title': 'Terminal Environment Proxy',
  'settingsPage.env.desc':
    'Injects the selected port into Windows user environment variables (http_proxy, https_proxy, all_proxy, no_proxy) for command-line and development tools. Fully decoupled from the system proxy, so a different node port can be used independently',
  'settingsPage.env.enableLabel':
    'Enable Terminal Environment Proxy (Windows HKCU)',
  'settingsPage.env.enableDesc':
    'Modifies user-level environment variables and broadcasts them to newly opened CMD, PowerShell, Git Bash, and development tools. Automatically cleaned up when the app exits or the port is disabled to prevent stale network loss',
  'settingsPage.env.portLabel': 'Listening Port for Terminal Proxy',
  'settingsPage.env.portDesc':
    'Independently selects the terminal egress node; does not need to match the system proxy',
  'settingsPage.env.resetLabel': 'Environment Variable Emergency Reset',
  'settingsPage.env.resetDesc':
    'If terminal proxy settings linger or networking is abnormal, clear proxy settings from Windows user environment variables in one click',
  'settingsPage.env.clearButton': 'Clear Terminal Proxy Variables',

  'settingsPage.tun.title': 'TUN Mode',
  'settingsPage.tun.desc':
    'Takes over all system traffic through a virtual network adapter; egress follows the selected listening port node and China direct-connect rules',
  'settingsPage.tun.enableLabel': 'Enable TUN Mode',
  'settingsPage.tun.enableDesc':
    'Requires administrator privileges; mutually exclusive with system proxy. Enabling clears the system proxy and reuses the current egress port',
  'settingsPage.tun.pendingTitle':
    'TUN inactive: administrator privileges required',
  'settingsPage.tun.pendingDesc':
    'Running as a standard user, so no virtual adapter was created. Restart as administrator with the button on the right to apply automatically',
  'settingsPage.tun.restartAdmin': 'Restart as Administrator',

  'settingsPage.appearance.acrylicLabel': 'Frosted Acrylic Glass',
  'settingsPage.appearance.acrylicDesc':
    'Enables translucent frosted-glass blur and light transmission for all panels and the sidebar',
  'settingsPage.appearance.blurLabel': 'Glass Blur',
  'settingsPage.appearance.blurDesc':
    'Adjusts the frosted-glass blur of the background ({value}px)',
  'settingsPage.appearance.opacityLabel': 'Panel Opacity',
  'settingsPage.appearance.opacityDesc':
    'Adjusts the translucency of card backgrounds ({value}%)',
  'settingsPage.appearance.bgLabel': 'Custom Background Wallpaper',
  'settingsPage.appearance.bgDesc':
    'Choose an image from your computer as the full-app background',
  'settingsPage.appearance.changeWallpaper': 'Change Wallpaper',
  'settingsPage.appearance.chooseImage': 'Choose Local Image',
  'settingsPage.appearance.clearWallpaper': 'Clear Wallpaper',
  'settingsPage.appearance.bgOpacityLabel': 'Wallpaper Opacity',
  'settingsPage.appearance.bgOpacityDesc':
    'Adjusts the visibility and brightness of the wallpaper ({value}%)',

  'settingsPage.system.title': 'Window & System Startup',
  'settingsPage.system.desc':
    'Manages system tray residency and launch-at-startup behavior',
  'settingsPage.system.closeToTrayLabel': 'Minimize to System Tray on Close',
  'settingsPage.system.closeToTrayDesc':
    'Hides the window when the close button (X) is clicked and keeps the proxy running in the background instead of quitting',
  'settingsPage.system.autoLaunchLabel': 'Launch at Startup',
  'settingsPage.system.autoLaunchDesc':
    'Starts the {app} client automatically when the operating system boots',
  'settingsPage.system.silentStartLabel': 'Silent Startup',
  'settingsPage.system.silentStartDesc':
    'Minimizes to the system tray on launch without opening the main window',
  'settingsPage.system.lightweightLabel': 'Lightweight Mode',
  'settingsPage.system.lightweightDesc':
    'Destroys the frontend UI on window close to reduce memory usage and reloads it when the tray icon is clicked',
  'settingsPage.system.resetSizeLabel': 'Reset Window Size',
  'settingsPage.system.resetSizeDesc':
    'Restores the window size and position to the default and clears the remembered state',
  'settingsPage.system.resetSizeButton': 'Restore Default Size',

  'settingsPage.storage.title': 'App Data & Profile Storage',
  'settingsPage.storage.desc':
    'All profile YAML files, runtime config, and core logs are stored in a local dedicated directory',
  'settingsPage.storage.openFolder': 'Open in File Explorer',
  'settingsPage.storage.currentDir':
    'Current data directory (app_local_data_dir)',
  'settingsPage.storage.reading': 'Reading...',

  'settingsPage.about.title': 'About & Updates',
  'settingsPage.about.desc':
    '{app} desktop client with one-click update checks and downloads of the matching installer or portable package from GitHub',
  'settingsPage.about.github': 'GitHub Repository',
  'settingsPage.about.checkUpdate': 'Check for Updates',
  'settingsPage.about.currentVersion': 'Current Version',
  'settingsPage.about.deployType': 'Deployment',
  'settingsPage.about.installer': 'Installer',
  'settingsPage.about.portable': 'Portable',
  'settingsPage.about.latestVersion': 'Latest Release',
  'settingsPage.about.notChecked': 'Not checked',
  'settingsPage.about.updateStatus': 'Update Status',
  'settingsPage.about.hasUpdate': 'New version available',
  'settingsPage.about.latest': 'Up to date',
  'settingsPage.about.pending': 'Pending check',
  'settingsPage.about.autoCheckLabel': 'Check for Updates at Startup and Daily',
  'settingsPage.about.autoCheckDesc':
    'Silently checks for a new version once at startup and once per day in the background. Checks and downloads try enabled listening ports in order and finally fall back to a direct connection',
  'settingsPage.about.lastCheckedLabel': 'Last checked: ',
  'settingsPage.about.never': 'Never checked',
  'settingsPage.about.newVersion': 'New version available: v{version}',
  'settingsPage.about.publishedAt': 'Published: {time}',
  'settingsPage.about.releaseNotesLink': 'View Release Notes',
  'settingsPage.about.selectAsset': 'Select download asset format:',
  'settingsPage.about.assetInstaller':
    'Installer (runs automatically and closes the old process)',
  'settingsPage.about.assetPortable':
    'Portable package (downloads to the root directory for extraction)',
  'settingsPage.about.singleInstaller':
    'Installer package: downloads, launches the installer, and exits the old process',
  'settingsPage.about.singlePortable':
    'Portable archive: downloads to the app root directory and opens the folder',
  'settingsPage.about.releaseNotes': 'Release Notes:',
  'settingsPage.about.stageReady': 'Download complete, processing...',
  'settingsPage.about.stageDownloading': 'Downloading update package...',
  'settingsPage.about.preparing': 'Preparing...',
  'settingsPage.about.downloadNow': 'Download and Update Now',

  'settingsPage.toast.noPort':
    'No available enabled listening port. Enable a port in port management first.',
  'settingsPage.toast.sysProxyEnabled': 'Port {port} is now the system proxy',
  'settingsPage.toast.sysProxyEnableFail':
    'Failed to enable system proxy: {error}',
  'settingsPage.toast.sysProxyDisabled': 'System proxy disabled',
  'settingsPage.toast.sysProxyDisableFail':
    'Failed to disable system proxy: {error}',
  'settingsPage.toast.envProxyEnabled':
    'Terminal environment proxy enabled (port {port})',
  'settingsPage.toast.envProxyEnableFail':
    'Failed to enable terminal proxy: {error}',
  'settingsPage.toast.envProxyDisabled':
    'Terminal environment proxy disabled and variables cleared',
  'settingsPage.toast.envProxyDisableFail':
    'Failed to disable terminal proxy: {error}',
  'settingsPage.toast.envPortSwitched':
    'Terminal proxy port switched to {port}',
  'settingsPage.toast.envPortPreset':
    'Terminal proxy preset port set to {port}',
  'settingsPage.toast.envPortFail':
    'Failed to update terminal proxy port: {error}',
  'settingsPage.toast.sysProxyPortSwitched':
    'System proxy port switched to {port}',
  'settingsPage.toast.tunPortSwitched': 'TUN egress port switched to {port}',
  'settingsPage.toast.outboundPortPreset': 'Outbound preset port set to {port}',
  'settingsPage.toast.outboundPortFail':
    'Failed to update outbound port: {error}',
  'settingsPage.toast.tunAdminRestart':
    'TUN mode requires administrator privileges. Restarting as administrator...',
  'settingsPage.toast.tunEnabled':
    'TUN mode enabled; global egress follows port {port}',
  'settingsPage.toast.tunDisabled': 'TUN mode disabled',
  'settingsPage.toast.localMarker':
    '"<local>" is a built-in OS exclusion marker and does not need to be added',
  'settingsPage.toast.bypassInvalid':
    'Invalid exclusion format. Use a domain (e.g. sheepyu.top), wildcard domain (e.g. *.sheepyu.top), IP (e.g. 119.29.106.76), or CIDR (e.g. 10.0.0.0/8). Single labels and the global wildcard * are not allowed.',
  'settingsPage.toast.bypassDuplicateCustom':
    'Exclusion "{item}" is already in the custom exclusion list',
  'settingsPage.toast.bypassDuplicateDefault':
    'Exclusion "{item}" already exists in the built-in exclusions',
  'settingsPage.toast.bypassAdded': 'Added excluded domain/IP: {item}',
  'settingsPage.toast.bypassAddFail': 'Failed to add: {error}',
  'settingsPage.toast.bypassRemoved': 'Removed exclusion: {item}',
  'settingsPage.toast.bypassRemoveFail': 'Failed to remove: {error}',
  'settingsPage.toast.uwpNewExempted': 'Auto-exempted {count} new app(s)',
  'settingsPage.toast.uwpCleaned':
    'Cleaned up stale exemptions for {count} uninstalled app(s)',
  'settingsPage.toast.uwpRefreshedDetails': 'Status refreshed: {details}',
  'settingsPage.toast.uwpRefreshed': 'UWP apps and exemption status refreshed',
  'settingsPage.toast.uwpRefreshFail':
    'Failed to refresh UWP exemption status: {error}',
  'settingsPage.toast.uwpExemptAll':
    'Removed loopback isolation for all {count} UWP apps; newly installed apps will be exempted automatically',
  'settingsPage.toast.uwpExemptFail': 'UWP loopback exemption failed: {error}',
  'settingsPage.toast.uwpCleared':
    'Cleared all UWP loopback exemptions and stopped auto-exempting new apps',
  'settingsPage.toast.uwpClearFail':
    'Failed to clear UWP loopback exemptions: {error}',
  'settingsPage.toast.kernelUpdateFound':
    'New Mihomo core version detected: {version}',
  'settingsPage.toast.kernelLatest':
    'The core is already up to date ({version})',
  'settingsPage.toast.kernelDownloading':
    'Downloading and verifying the new core, please wait...',
  'settingsPage.toast.kernelUpgraded':
    'Core upgraded successfully! Switched to {version} seamlessly',
  'settingsPage.toast.rulesDownloading':
    'Fetching the latest official MRS rule set, please wait...',
  'settingsPage.toast.rulesUpdated':
    'China routing rule set updated to the latest version!',
  'settingsPage.toast.appUpdateFound': 'New app version detected: v{version}',
  'settingsPage.toast.appLatest': 'The app is already up to date (v{version})',
  'settingsPage.toast.appCheckFail': 'Failed to check for app updates: {error}',
  'settingsPage.toast.assetNotFound':
    'No update package found for this platform',
  'settingsPage.toast.installerStarted':
    'Installer launched; closing the old app...',
  'settingsPage.toast.portableReady': 'Portable package downloaded',
  'settingsPage.toast.appUpdateFail': 'Update failed: {error}',
  'settingsPage.toast.lanEnabled': 'LAN connections enabled',
  'settingsPage.toast.lanDisabled': 'Restored to localhost-only listening',
  'settingsPage.toast.testUrlUpdated':
    'Health-check and latency-test URL updated',
  'settingsPage.toast.timeoutRange':
    'Timeout must be an integer between {min} and {max} ms',
  'settingsPage.toast.timeoutUpdated':
    'Latency test and failure timeout updated to {ms} ms',
  'settingsPage.toast.fallbackRange':
    'Check interval must be an integer between {min} and {max} seconds',
  'settingsPage.toast.fallbackUpdated':
    'Fallback probe interval updated to {sec} seconds',
  'settingsPage.toast.lazyOn': 'Lazy health check enabled',
  'settingsPage.toast.lazyOff': 'Restored continuous active health checks',
  'settingsPage.toast.invalidImage':
    'Please select a valid image file (PNG, JPG, WebP, etc.)',
  'settingsPage.toast.bgApplied': 'Background wallpaper applied',
  'settingsPage.toast.bgCleared': 'Background wallpaper cleared',
  'settingsPage.toast.autoLaunchOn': 'Launch at startup enabled',
  'settingsPage.toast.autoLaunchOff': 'Launch at startup disabled',
  'settingsPage.toast.lightweightOn': 'Lightweight mode enabled',
  'settingsPage.toast.lightweightOff': 'Lightweight mode disabled',
  'settingsPage.toast.autoCheckOn': 'Automatic update checks enabled',
  'settingsPage.toast.autoCheckOff': 'Automatic update checks disabled',
  'settingsPage.toast.windowReset': 'Window size restored to default',
  'settingsPage.toast.windowResetFail': 'Failed to reset window size: {error}',
  'settingsPage.toast.envCleared':
    'Proxy settings cleared from user environment variables',
  'settingsPage.toast.envClearFail': 'Failed to clear: {error}',
  'app.profileUpdateFailed': 'Failed to fetch subscription "{name}": {error}',
  'app.profileUpdateFallbackError': 'Network or parsing error',
  'app.profileUpdateFailedTitle': 'Subscription auto-update failed',
  'app.portToggleFailedTitle': 'Failed to switch tray port',
  'app.kernelCrashedReason': ' ({reason})',
  'app.kernelCrashed':
    'Mihomo core exited unexpectedly{reason}. Check the core logs.',
  'app.kernelCrashedTitle': 'Core stopped unexpectedly',
  'app.kernelCrashedProtection':
    'Mihomo core exited unexpectedly{reason}. To prevent a system-wide outage, the system proxy was disabled and traffic was switched to DIRECT.',
  'app.kernelCrashedProtectionTitle': 'Core crash & network protection',
  'app.proxyRestored':
    'Mihomo core is running again; the system proxy was restored to port :{port}.',
  'app.proxyRestoredTitle': 'System proxy restored',
  'ports.latencyTesting': 'Testing...',
  'ports.latencyTimeout': 'Timeout',
  'ports.residentialProxyTooltip':
    'Residential proxy {protocol} {server}:{port}',
  'filePicker.clashYaml': 'Clash YAML config file',
  'filePicker.allFiles': 'All files',
  'errors.chainEgressDesktopOnly':
    'Chain egress detection is only available in the desktop app',
  'errors.residentialManagementDesktopOnly':
    'Residential exit management is only available in the desktop app',
  'errors.configNotLoaded':
    'Configuration is not loaded yet; try again shortly',
  'errors.residentialProxyInUse':
    'This residential exit is used by ports {ports}; unbind them first',
  'errors.chainConfigChanged':
    'Chain configuration changed; re-detect the egress IP',
  'common.listSeparator': ', ',
  'rules.presetCategory.all': 'All',
  'rules.presetCategory.ai': 'AI Models',
  'rules.presetCategory.social': 'Social & Messaging',
  'rules.presetCategory.dev': 'Development & Work',
  'rules.presetCategory.media': 'Streaming & Media',
  'rules.presetCategory.game': 'Gaming',
  'rules.presetCategory.general': 'General',

  'rules.presetService.openai.name': 'OpenAI / ChatGPT',
  'rules.presetService.claude.name': 'Claude (Anthropic)',
  'rules.presetService.gemini.name': 'Google Gemini (AI)',
  'rules.presetService.copilot.name': 'Microsoft Copilot',
  'rules.presetService.cursor.name': 'Cursor AI',
  'rules.presetService.perplexity.name': 'Perplexity AI',
  'rules.presetService.groq.name': 'Groq',
  'rules.presetService.midjourney.name': 'Midjourney',
  'rules.presetService.huggingface.name': 'Hugging Face',
  'rules.presetService.twitter.name': 'X (Twitter)',
  'rules.presetService.telegram.name': 'Telegram',
  'rules.presetService.discord.name': 'Discord',
  'rules.presetService.reddit.name': 'Reddit',
  'rules.presetService.instagram.name': 'Instagram',
  'rules.presetService.facebook.name': 'Meta (Facebook)',
  'rules.presetService.threads.name': 'Threads',
  'rules.presetService.tiktok.name': 'TikTok',
  'rules.presetService.github.name': 'GitHub',
  'rules.presetService.docker.name': 'Docker Hub',
  'rules.presetService.notion.name': 'Notion',
  'rules.presetService.figma.name': 'Figma',
  'rules.presetService.slack.name': 'Slack',
  'rules.presetService.stackoverflow.name': 'Stack Overflow',
  'rules.presetService.vercel.name': 'Vercel',
  'rules.presetService.youtube.name': 'YouTube',
  'rules.presetService.netflix.name': 'Netflix',
  'rules.presetService.spotify.name': 'Spotify',
  'rules.presetService.disney.name': 'Disney+',
  'rules.presetService.twitch.name': 'Twitch',
  'rules.presetService.steam.name': 'Steam',
  'rules.presetService.epic.name': 'Epic Games',
  'rules.presetService.playstation.name': 'PlayStation Network',
  'rules.presetService.google.name': 'Google (Full Suite)',
  'rules.presetService.wikipedia.name': 'Wikipedia',
  'rules.presetService.amazon.name': 'Amazon',

  'rules.presetService.openai.description':
    'ChatGPT, API, Sora, and static assets',
  'rules.presetService.claude.description':
    'Claude web, chat, and Anthropic API',
  'rules.presetService.gemini.description':
    'Gemini chat, AI Studio, and Google AI API',
  'rules.presetService.copilot.description':
    'Microsoft Copilot assistant and Bing AI',
  'rules.presetService.cursor.description':
    'Cursor editor cloud inference and update services',
  'rules.presetService.perplexity.description': 'Perplexity AI search and API',
  'rules.presetService.groq.description':
    'Ultra-fast LPU cloud inference platform',
  'rules.presetService.midjourney.description':
    'Midjourney image generation and web platform',
  'rules.presetService.huggingface.description':
    'Open-source AI models and datasets community',
  'rules.presetService.twitter.description':
    'X web, clients, static assets, and x.ai',
  'rules.presetService.telegram.description':
    'Telegram messaging and short-link services',
  'rules.presetService.discord.description':
    'Discord voice, community channels, and CDN',
  'rules.presetService.reddit.description':
    'Reddit community discussions and media',
  'rules.presetService.instagram.description':
    'Instagram social photos and videos',
  'rules.presetService.facebook.description':
    'Facebook, Messenger, and the Meta ecosystem',
  'rules.presetService.threads.description': 'Meta text-sharing community',
  'rules.presetService.tiktok.description':
    'TikTok short videos (global) and CDN',
  'rules.presetService.github.description':
    'GitHub code hosting, assets, and Pages',
  'rules.presetService.docker.description':
    'Docker image registry and downloads',
  'rules.presetService.notion.description':
    'Notion notes and workspace collaboration',
  'rules.presetService.figma.description':
    'Figma online design and collaboration',
  'rules.presetService.slack.description':
    'Slack team messaging and edge network',
  'rules.presetService.stackoverflow.description':
    'Developer Q&A community and network',
  'rules.presetService.vercel.description':
    'Frontend cloud platform and edge deployments',
  'rules.presetService.youtube.description':
    'YouTube videos, live streams, and full media CDN',
  'rules.presetService.netflix.description':
    'Netflix streaming and full video CDN',
  'rules.presetService.spotify.description': 'Spotify music streaming and CDN',
  'rules.presetService.disney.description': 'Disney+ streaming video on demand',
  'rules.presetService.twitch.description':
    'Game streaming and interactive video platform',
  'rules.presetService.steam.description':
    'Steam store, community, friends, and download CDN',
  'rules.presetService.epic.description':
    'Epic Games Store and Unreal Engine services',
  'rules.presetService.playstation.description':
    'Sony PSN store and online multiplayer services',
  'rules.presetService.google.description':
    'Google Search, API, Drive, Maps, and core services',
  'rules.presetService.wikipedia.description':
    'Wikipedia and free multimedia archive',
  'rules.presetService.amazon.description':
    'Amazon global e-commerce and retail services',
}
