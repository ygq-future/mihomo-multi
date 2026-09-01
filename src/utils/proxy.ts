export interface RegionInfo {
  flag: string
  code: string
  name: string
}

// Regex to extract unicode emoji flags (regional indicator pairs)
const EMOJI_FLAG_REGEX =
  /[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]|[\uD83C][\uDDF7][\uD83C][\uDDF8]/

const REGION_RULES: Array<{
  keywords: string[]
  flag: string
  code: string
  name: string
}> = [
  {
    keywords: ['香港', 'hk', 'hong kong', 'hongkong', 'hkg'],
    flag: '🇭🇰',
    code: 'HK',
    name: '中国香港',
  },
  {
    keywords: ['台湾', 'tw', 'taiwan', 'tpe', '台北'],
    flag: '🇹🇼',
    code: 'TW',
    name: '中国台湾',
  },
  {
    keywords: ['日本', 'jp', 'japan', 'tokyo', 'osaka', '东京', '大阪'],
    flag: '🇯🇵',
    code: 'JP',
    name: '日本',
  },
  {
    keywords: [
      '美国',
      'us',
      'united states',
      'usa',
      'los angeles',
      'san jose',
      'new york',
      '洛杉矶',
      '圣何塞',
      '纽约',
      '硅谷',
      '西雅图',
      '芝加哥',
    ],
    flag: '🇺🇸',
    code: 'US',
    name: '美国',
  },
  {
    keywords: ['新加坡', 'sg', 'singapore', 'sin', '狮城'],
    flag: '🇸🇬',
    code: 'SG',
    name: '新加坡',
  },
  {
    keywords: ['韩国', 'kr', 'korea', 'south korea', 'seoul', '首尔'],
    flag: '🇰🇷',
    code: 'KR',
    name: '韩国',
  },
  {
    keywords: [
      '英国',
      'uk',
      'united kingdom',
      'gb',
      'great britain',
      'london',
      '伦敦',
    ],
    flag: '🇬🇧',
    code: 'UK',
    name: '英国',
  },
  {
    keywords: ['德国', 'de', 'germany', 'frankfurt', '法兰克福'],
    flag: '🇩🇪',
    code: 'DE',
    name: '德国',
  },
  {
    keywords: ['法国', 'fr', 'france', 'paris', '巴黎'],
    flag: '🇫🇷',
    code: 'FR',
    name: '法国',
  },
  {
    keywords: [
      '加拿大',
      'ca',
      'canada',
      'toronto',
      'vancouver',
      '多伦多',
      '温哥华',
    ],
    flag: '🇨🇦',
    code: 'CA',
    name: '加拿大',
  },
  {
    keywords: [
      '澳大利亚',
      'au',
      'australia',
      'sydney',
      'melbourne',
      '悉尼',
      '墨尔本',
    ],
    flag: '🇦🇺',
    code: 'AU',
    name: '澳大利亚',
  },
  {
    keywords: ['荷兰', 'nl', 'netherlands', 'amsterdam', '阿姆斯特丹'],
    flag: '🇳🇱',
    code: 'NL',
    name: '荷兰',
  },
  {
    keywords: ['俄罗斯', 'ru', 'russia', 'moscow', '莫斯科'],
    flag: '🇷🇺',
    code: 'RU',
    name: '俄罗斯',
  },
  {
    keywords: ['印度', 'in', 'india', 'mumbai', '孟买'],
    flag: '🇮🇳',
    code: 'IN',
    name: '印度',
  },
  {
    keywords: ['土耳其', 'tr', 'turkey', 'istanbul', '伊斯坦布尔'],
    flag: '🇹🇷',
    code: 'TR',
    name: '土耳其',
  },
  {
    keywords: ['阿联酋', 'ae', 'uae', 'dubai', '迪拜'],
    flag: '🇦🇪',
    code: 'AE',
    name: '阿联酋',
  },
  {
    keywords: ['中国', 'cn', 'china', '回国', '北京', '上海', '广州', '深圳'],
    flag: '🇨🇳',
    code: 'CN',
    name: '中国大陆',
  },
]

export function extractRegion(nodeName: string): RegionInfo {
  // 1. Check if name already has an emoji flag
  const emojiMatch = nodeName.match(EMOJI_FLAG_REGEX)
  const flagFromEmoji = emojiMatch ? emojiMatch[0] : null

  const lowerName = nodeName.toLowerCase()

  for (const rule of REGION_RULES) {
    if (rule.keywords.some((kw) => lowerName.includes(kw))) {
      return {
        flag: flagFromEmoji || rule.flag,
        code: rule.code,
        name: rule.name,
      }
    }
  }

  return {
    flag: flagFromEmoji || '🌐',
    code: 'OTHER',
    name: '其它地区',
  }
}

export function getLatencyBadgeProps(
  latency: number | null | undefined,
  isTesting: boolean,
): {
  variant: 'success' | 'warning' | 'danger' | 'default'
  label: string
  dot: boolean
} {
  if (isTesting) {
    return {
      variant: 'default',
      label: '测速中...',
      dot: false,
    }
  }

  if (latency === undefined) {
    return {
      variant: 'default',
      label: '未测速',
      dot: false,
    }
  }

  if (latency === null) {
    return {
      variant: 'danger',
      label: '超时',
      dot: true,
    }
  }

  if (latency < 150) {
    return {
      variant: 'success',
      label: `${latency} ms`,
      dot: true,
    }
  }

  if (latency <= 300) {
    return {
      variant: 'warning',
      label: `${latency} ms`,
      dot: true,
    }
  }

  return {
    variant: 'danger',
    label: `${latency} ms`,
    dot: true,
  }
}

export function getLatencyColor(latency?: number | null): string {
  if (latency === undefined || latency === null) return 'text-muted-foreground'
  if (latency < 150) return 'text-emerald-500'
  if (latency <= 300) return 'text-amber-500'
  return 'text-rose-500'
}

export function getProtocolBadgeProps(type: string): {
  label: string
  className: string
} {
  const norm = type.toLowerCase()
  switch (norm) {
    case 'ss':
    case 'shadowsocks':
      return {
        label: 'SS',
        className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      }
    case 'vmess':
      return {
        label: 'VMess',
        className: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      }
    case 'vless':
      return {
        label: 'VLESS',
        className: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      }
    case 'trojan':
      return {
        label: 'Trojan',
        className: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
      }
    case 'hysteria2':
    case 'hy2':
      return {
        label: 'Hy2',
        className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      }
    case 'snell':
      return {
        label: 'Snell',
        className: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
      }
    case 'socks5':
      return {
        label: 'Socks5',
        className: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
      }
    case 'http':
      return {
        label: 'HTTP',
        className: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
      }
    default:
      return {
        label: type.toUpperCase(),
        className: 'bg-secondary text-muted-foreground border-border',
      }
  }
}
