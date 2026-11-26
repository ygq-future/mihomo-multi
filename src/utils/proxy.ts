import type { DirectEgressInfo } from '../types'

export interface RegionInfo {
  flag: string
  code: string
  name: string
}

// Regex to extract unicode emoji flags (regional indicator pairs)
const EMOJI_FLAG_REGEX = /[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/

interface RegionRule {
  keywords: string[]
  flag: string
  code: string
  name: string
}

const REGION_RULES: RegionRule[] = [
  {
    keywords: ['香港', 'hk', 'hong kong', 'hongkong', 'hkg'],
    flag: '🇭🇰',
    code: 'HK',
    name: '中国香港',
  },
  {
    keywords: ['澳门', '澳門', 'mo', 'macau', 'macao', 'mfm'],
    flag: '🇲🇴',
    code: 'MO',
    name: '中国澳门',
  },
  {
    keywords: [
      '台湾',
      '台灣',
      'tw',
      'taiwan',
      'tpe',
      '台北',
      '臺北',
      '高雄',
      '台中',
    ],
    flag: '🇹🇼',
    code: 'TW',
    name: '中国台湾',
  },
  {
    keywords: [
      '日本',
      'jp',
      'jpn',
      'japan',
      'tokyo',
      'osaka',
      'nrt',
      'kix',
      '东京',
      '大阪',
      '埼玉',
      '千叶',
    ],
    flag: '🇯🇵',
    code: 'JP',
    name: '日本',
  },
  {
    keywords: [
      '美国',
      '美國',
      'us',
      'usa',
      'united states',
      'america',
      'los angeles',
      'san jose',
      'new york',
      'seattle',
      'chicago',
      'dallas',
      'miami',
      'ashburn',
      'phoenix',
      'silicon valley',
      '洛杉矶',
      '圣何塞',
      '纽约',
      '硅谷',
      '西雅图',
      '芝加哥',
      '达拉斯',
      '迈阿密',
      '凤凰城',
      '华盛顿',
      '波特兰',
    ],
    flag: '🇺🇸',
    code: 'US',
    name: '美国',
  },
  {
    keywords: ['新加坡', 'sg', 'sgp', 'singapore', 'sin', '狮城', '坡县'],
    flag: '🇸🇬',
    code: 'SG',
    name: '新加坡',
  },
  {
    keywords: [
      '韩国',
      '韓國',
      'kr',
      'kor',
      'korea',
      'south korea',
      'seoul',
      'icn',
      'busan',
      '首尔',
      '釜山',
      '春川',
    ],
    flag: '🇰🇷',
    code: 'KR',
    name: '韩国',
  },
  {
    keywords: [
      '英国',
      '英國',
      'uk',
      'gb',
      'gbr',
      'united kingdom',
      'great britain',
      'britain',
      'england',
      'london',
      'manchester',
      'lhr',
      '伦敦',
      '曼彻斯特',
    ],
    flag: '🇬🇧',
    code: 'UK',
    name: '英国',
  },
  {
    keywords: [
      '德国',
      '德國',
      'de',
      'deu',
      'germany',
      'frankfurt',
      'berlin',
      'munich',
      'fra',
      '法兰克福',
      '柏林',
      '慕尼黑',
      '纽伦堡',
    ],
    flag: '🇩🇪',
    code: 'DE',
    name: '德国',
  },
  {
    keywords: [
      '法国',
      '法國',
      'fr',
      'france',
      'paris',
      'marseille',
      'cdg',
      '巴黎',
      '马赛',
    ],
    flag: '🇫🇷',
    code: 'FR',
    name: '法国',
  },
  {
    keywords: [
      '加拿大',
      'ca',
      'can',
      'canada',
      'toronto',
      'vancouver',
      'montreal',
      'yyz',
      'yvr',
      '多伦多',
      '温哥华',
      '蒙特利尔',
    ],
    flag: '🇨🇦',
    code: 'CA',
    name: '加拿大',
  },
  {
    keywords: [
      '澳大利亚',
      '澳洲',
      'au',
      'aus',
      'australia',
      'sydney',
      'melbourne',
      'brisbane',
      'perth',
      'syd',
      'mel',
      '悉尼',
      '墨尔本',
      '布里斯班',
      '珀斯',
    ],
    flag: '🇦🇺',
    code: 'AU',
    name: '澳大利亚',
  },
  {
    keywords: [
      '荷兰',
      '荷蘭',
      'nl',
      'nld',
      'netherlands',
      'holland',
      'amsterdam',
      'ams',
      '阿姆斯特丹',
    ],
    flag: '🇳🇱',
    code: 'NL',
    name: '荷兰',
  },
  {
    keywords: [
      '俄罗斯',
      '俄羅斯',
      '俄国',
      'ru',
      'rus',
      'russia',
      'moscow',
      'saint petersburg',
      '莫斯科',
      '圣彼得堡',
      '伯力',
      '海参崴',
    ],
    flag: '🇷🇺',
    code: 'RU',
    name: '俄罗斯',
  },
  {
    keywords: [
      '印度',
      'in',
      'ind',
      'india',
      'mumbai',
      'delhi',
      'bangalore',
      'chennai',
      '孟买',
      '新德里',
      '班加罗尔',
    ],
    flag: '🇮🇳',
    code: 'IN',
    name: '印度',
  },
  {
    keywords: [
      '土耳其',
      'tr',
      'tur',
      'turkey',
      'turkiye',
      'türkiye',
      'istanbul',
      'ankara',
      'ist',
      '伊斯坦布尔',
    ],
    flag: '🇹🇷',
    code: 'TR',
    name: '土耳其',
  },
  {
    keywords: [
      '阿联酋',
      '阿聯酋',
      'ae',
      'uae',
      'dubai',
      'abu dhabi',
      'dxb',
      '迪拜',
      '阿布扎比',
    ],
    flag: '🇦🇪',
    code: 'AE',
    name: '阿联酋',
  },
  {
    keywords: [
      '阿根廷',
      'ar',
      'arg',
      'argentina',
      'buenos aires',
      '布宜诺斯艾利斯',
    ],
    flag: '🇦🇷',
    code: 'AR',
    name: '阿根廷',
  },
  {
    keywords: [
      '乌克兰',
      '烏克蘭',
      'ua',
      'ukr',
      'ukraine',
      'kyiv',
      'kiev',
      '基辅',
    ],
    flag: '🇺🇦',
    code: 'UA',
    name: '乌克兰',
  },
  {
    keywords: [
      '马来西亚',
      '馬來西亞',
      '马来',
      '馬來',
      '大马',
      'my',
      'mys',
      'malaysia',
      'kuala lumpur',
      'kul',
      '吉隆坡',
    ],
    flag: '🇲🇾',
    code: 'MY',
    name: '马来西亚',
  },
  {
    keywords: [
      '泰国',
      '泰國',
      'th',
      'tha',
      'thailand',
      'bangkok',
      'bkk',
      '曼谷',
    ],
    flag: '🇹🇭',
    code: 'TH',
    name: '泰国',
  },
  {
    keywords: [
      '越南',
      'vn',
      'vnm',
      'vietnam',
      'ho chi minh',
      'hanoi',
      '胡志明',
      '河内',
    ],
    flag: '🇻🇳',
    code: 'VN',
    name: '越南',
  },
  {
    keywords: [
      '菲律宾',
      '菲律賓',
      'ph',
      'phl',
      'philippines',
      'manila',
      'mnl',
      '马尼拉',
    ],
    flag: '🇵🇭',
    code: 'PH',
    name: '菲律宾',
  },
  {
    keywords: [
      '印度尼西亚',
      '印尼',
      'id',
      'idn',
      'indonesia',
      'jakarta',
      'cgk',
      '雅加达',
    ],
    flag: '🇮🇩',
    code: 'ID',
    name: '印度尼西亚',
  },
  {
    keywords: [
      '巴西',
      'br',
      'bra',
      'brazil',
      'brasil',
      'sao paulo',
      'são paulo',
      '圣保罗',
    ],
    flag: '🇧🇷',
    code: 'BR',
    name: '巴西',
  },
  {
    keywords: ['墨西哥', 'mx', 'mex', 'mexico', 'queretaro'],
    flag: '🇲🇽',
    code: 'MX',
    name: '墨西哥',
  },
  {
    keywords: ['智利', 'cl', 'chl', 'chile', 'santiago', '圣地亚哥'],
    flag: '🇨🇱',
    code: 'CL',
    name: '智利',
  },
  {
    keywords: [
      '哥伦比亚',
      '哥倫比亞',
      'co',
      'col',
      'colombia',
      'bogota',
      '波哥大',
    ],
    flag: '🇨🇴',
    code: 'CO',
    name: '哥伦比亚',
  },
  {
    keywords: ['秘鲁', '秘魯', 'pe', 'per', 'peru', 'lima', '利马'],
    flag: '🇵🇪',
    code: 'PE',
    name: '秘鲁',
  },
  {
    keywords: [
      '意大利',
      '義大利',
      'it',
      'ita',
      'italy',
      'milan',
      'rome',
      '米兰',
      '罗马',
    ],
    flag: '🇮🇹',
    code: 'IT',
    name: '意大利',
  },
  {
    keywords: [
      '西班牙',
      'es',
      'esp',
      'spain',
      'madrid',
      'barcelona',
      '马德里',
      '巴塞罗那',
    ],
    flag: '🇪🇸',
    code: 'ES',
    name: '西班牙',
  },
  {
    keywords: ['葡萄牙', 'pt', 'prt', 'portugal', 'lisbon', '里斯本'],
    flag: '🇵🇹',
    code: 'PT',
    name: '葡萄牙',
  },
  {
    keywords: [
      '瑞士',
      'ch',
      'che',
      'switzerland',
      'zurich',
      'geneva',
      '苏黎世',
      '日内瓦',
    ],
    flag: '🇨🇭',
    code: 'CH',
    name: '瑞士',
  },
  {
    keywords: ['瑞典', 'se', 'swe', 'sweden', 'stockholm', '斯德哥尔摩'],
    flag: '🇸🇪',
    code: 'SE',
    name: '瑞典',
  },
  {
    keywords: ['挪威', 'no', 'nor', 'norway', 'oslo', '奥斯陆'],
    flag: '🇳🇴',
    code: 'NO',
    name: '挪威',
  },
  {
    keywords: ['芬兰', '芬蘭', 'fi', 'fin', 'finland', 'helsinki', '赫尔辛基'],
    flag: '🇫🇮',
    code: 'FI',
    name: '芬兰',
  },
  {
    keywords: [
      '丹麦',
      '丹麥',
      'dk',
      'dnk',
      'denmark',
      'copenhagen',
      '哥本哈根',
    ],
    flag: '🇩🇰',
    code: 'DK',
    name: '丹麦',
  },
  {
    keywords: ['波兰', '波蘭', 'pl', 'pol', 'poland', 'warsaw', '华沙'],
    flag: '🇵🇱',
    code: 'PL',
    name: '波兰',
  },
  {
    keywords: ['奥地利', '奧地利', 'at', 'aut', 'austria', 'vienna', '维也纳'],
    flag: '🇦🇹',
    code: 'AT',
    name: '奥地利',
  },
  {
    keywords: [
      '比利时',
      '比利時',
      'be',
      'bel',
      'belgium',
      'brussels',
      '布鲁塞尔',
    ],
    flag: '🇧🇪',
    code: 'BE',
    name: '比利时',
  },
  {
    keywords: ['爱尔兰', '愛爾蘭', 'ie', 'irl', 'ireland', 'dublin', '都柏林'],
    flag: '🇮🇪',
    code: 'IE',
    name: '爱尔兰',
  },
  {
    keywords: ['捷克', 'cz', 'cze', 'czech', 'czechia', 'prague', '布拉格'],
    flag: '🇨🇿',
    code: 'CZ',
    name: '捷克',
  },
  {
    keywords: [
      '罗马尼亚',
      '羅馬尼亞',
      'ro',
      'rou',
      'romania',
      'bucharest',
      '布加勒斯特',
    ],
    flag: '🇷🇴',
    code: 'RO',
    name: '罗马尼亚',
  },
  {
    keywords: ['匈牙利', 'hu', 'hun', 'hungary', 'budapest', '布达佩斯'],
    flag: '🇭🇺',
    code: 'HU',
    name: '匈牙利',
  },
  {
    keywords: ['希腊', '希臘', 'gr', 'grc', 'greece', 'athens', '雅典'],
    flag: '🇬🇷',
    code: 'GR',
    name: '希腊',
  },
  {
    keywords: [
      '保加利亚',
      '保加利亞',
      'bg',
      'bgr',
      'bulgaria',
      'sofia',
      '索菲亚',
    ],
    flag: '🇧🇬',
    code: 'BG',
    name: '保加利亚',
  },
  {
    keywords: ['卢森堡', '盧森堡', 'lu', 'lux', 'luxembourg'],
    flag: '🇱🇺',
    code: 'LU',
    name: '卢森堡',
  },
  {
    keywords: [
      '冰岛',
      '冰島',
      'is',
      'isl',
      'iceland',
      'reykjavik',
      '雷克雅未克',
    ],
    flag: '🇮🇸',
    code: 'IS',
    name: '冰岛',
  },
  {
    keywords: ['以色列', 'il', 'isr', 'israel', 'tel aviv', '特拉维夫'],
    flag: '🇮🇱',
    code: 'IL',
    name: '以色列',
  },
  {
    keywords: ['沙特', '沙特阿拉伯', 'sa', 'sau', 'saudi', 'riyadh', '利雅得'],
    flag: '🇸🇦',
    code: 'SA',
    name: '沙特阿拉伯',
  },
  {
    keywords: [
      '南非',
      'za',
      'zaf',
      'south africa',
      'johannesburg',
      '约翰内斯堡',
    ],
    flag: '🇿🇦',
    code: 'ZA',
    name: '南非',
  },
  {
    keywords: ['埃及', 'eg', 'egy', 'egypt', 'cairo', '开罗'],
    flag: '🇪🇬',
    code: 'EG',
    name: '埃及',
  },
  {
    keywords: [
      '尼日利亚',
      '尼日利亞',
      'ng',
      'nga',
      'nigeria',
      'lagos',
      '拉各斯',
    ],
    flag: '🇳🇬',
    code: 'NG',
    name: '尼日利亚',
  },
  {
    keywords: [
      '新西兰',
      '紐西蘭',
      'nz',
      'nzl',
      'new zealand',
      'auckland',
      '奥克兰',
    ],
    flag: '🇳🇿',
    code: 'NZ',
    name: '新西兰',
  },
  {
    keywords: ['巴基斯坦', 'pk', 'pak', 'pakistan', 'karachi', 'lahore'],
    flag: '🇵🇰',
    code: 'PK',
    name: '巴基斯坦',
  },
  {
    keywords: ['孟加拉', '孟加拉国', 'bd', 'bgd', 'bangladesh', 'dhaka'],
    flag: '🇧🇩',
    code: 'BD',
    name: '孟加拉国',
  },
  {
    keywords: ['哈萨克斯坦', '哈薩克', 'kz', 'kaz', 'kazakhstan', 'almaty'],
    flag: '🇰🇿',
    code: 'KZ',
    name: '哈萨克斯坦',
  },
  {
    keywords: ['柬埔寨', 'kh', 'khm', 'cambodia', 'phnom penh', '金边'],
    flag: '🇰🇭',
    code: 'KH',
    name: '柬埔寨',
  },
  {
    keywords: ['缅甸', '緬甸', 'mm', 'mmr', 'myanmar', 'yangon'],
    flag: '🇲🇲',
    code: 'MM',
    name: '缅甸',
  },
  {
    keywords: ['尼泊尔', '尼泊爾', 'np', 'npl', 'nepal', 'kathmandu'],
    flag: '🇳🇵',
    code: 'NP',
    name: '尼泊尔',
  },
  {
    keywords: ['南极', '南極', 'aq', 'antarctica'],
    flag: '🇦🇶',
    code: 'AQ',
    name: '南极洲',
  },
  {
    keywords: ['中国', 'cn', 'china', '回国', '北京', '上海', '广州', '深圳'],
    flag: '🇨🇳',
    code: 'CN',
    name: '中国大陆',
  },
]

const REGION_BY_CODE = new Map<string, RegionRule>(
  REGION_RULES.map((rule) => [rule.code, rule]),
)

function decodeFlagEmojiToCode(flag: string): string | null {
  const cps = Array.from(flag, (ch) => ch.codePointAt(0) ?? 0)
  if (cps.length !== 2) return null
  const [first, second] = cps
  if (
    first < 0x1f1e6 ||
    first > 0x1f1ff ||
    second < 0x1f1e6 ||
    second > 0x1f1ff
  ) {
    return null
  }
  const code =
    String.fromCharCode(first - 0x1f1e6 + 65) +
    String.fromCharCode(second - 0x1f1e6 + 65)
  return code === 'GB' ? 'UK' : code
}

function matchesRegionKeyword(lowerName: string, keyword: string): boolean {
  // Short ASCII codes (e.g. us/ar/ua/my/mo) require non-letter boundaries to avoid false positives in words like "cloudflare" or "mobile".
  if (keyword.length <= 3 && /^[a-z]+$/.test(keyword)) {
    let idx = lowerName.indexOf(keyword)
    while (idx !== -1) {
      const prevCode = idx > 0 ? lowerName.charCodeAt(idx - 1) : 0
      const prevOk = idx === 0 || prevCode < 97 || prevCode > 122
      const nextIdx = idx + keyword.length
      const nextCode =
        nextIdx < lowerName.length ? lowerName.charCodeAt(nextIdx) : 0
      const nextOk =
        nextIdx === lowerName.length || nextCode < 97 || nextCode > 122
      if (prevOk && nextOk) return true
      idx = lowerName.indexOf(keyword, idx + 1)
    }
    return false
  }
  return lowerName.includes(keyword)
}

const regionCache = new Map<string, RegionInfo>()

export function extractRegion(nodeName: string): RegionInfo {
  if (!nodeName) {
    return { flag: '🌐', code: 'OTHER', name: '其它地区' }
  }
  const cached = regionCache.get(nodeName)
  if (cached) return cached

  // 1. Check if name already has an emoji flag and resolve it directly when known
  const emojiMatch = nodeName.match(EMOJI_FLAG_REGEX)
  const flagFromEmoji = emojiMatch ? emojiMatch[0] : null
  if (flagFromEmoji) {
    const emojiCode = decodeFlagEmojiToCode(flagFromEmoji)
    if (emojiCode) {
      const ruleFromFlag = REGION_BY_CODE.get(emojiCode)
      if (ruleFromFlag) {
        const res = {
          flag: flagFromEmoji,
          code: ruleFromFlag.code,
          name: ruleFromFlag.name,
        }
        regionCache.set(nodeName, res)
        return res
      }
    }
  }

  const lowerName = nodeName.toLowerCase()

  for (const rule of REGION_RULES) {
    if (rule.keywords.some((kw) => matchesRegionKeyword(lowerName, kw))) {
      const res = {
        flag: flagFromEmoji || rule.flag,
        code: rule.code,
        name: rule.name,
      }
      regionCache.set(nodeName, res)
      return res
    }
  }

  const fallback = {
    flag: flagFromEmoji || '🌐',
    code: 'OTHER',
    name: '其它地区',
  }
  regionCache.set(nodeName, fallback)
  return fallback
}

/**
 * Return hidden search keywords for a recognized region (e.g. ISO code like "us"/"hk"/"jp"
 * plus Chinese region name) so dropdown search matches even when the node name omits the code.
 */
export function getRegionSearchKeywords(region: RegionInfo): string[] {
  if (!region.code || region.code === 'OTHER') return []
  const code = region.code.toLowerCase()
  const aliases = code === 'uk' ? ['uk', 'gb'] : [code]
  return [...aliases, region.name.toLowerCase()]
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

export function formatProtocolName(type: string): string {
  const norm = type.toLowerCase()
  switch (norm) {
    case 'ss':
    case 'shadowsocks':
      return 'Shadowsocks'
    case 'vmess':
      return 'Vmess'
    case 'vless':
      return 'Vless'
    case 'trojan':
      return 'Trojan'
    case 'hysteria2':
    case 'hy2':
      return 'Hy2'
    case 'tuic':
      return 'Tuic'
    case 'snell':
      return 'Snell'
    case 'anytls':
      return 'AnyTLS'
    case 'socks5':
      return 'Socks5'
    case 'http':
      return 'Http'
    default:
      return type.charAt(0).toUpperCase() + type.slice(1)
  }
}

export function getProtocolBadgeProps(type: string): {
  label: string
  className: string
} {
  switch (type.toLowerCase()) {
    case 'ss':
    case 'shadowsocks':
      return {
        label: 'SS',
        className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      }
    case 'ssr':
    case 'shadowsocksr':
      return {
        label: 'SSR',
        className: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
      }
    case 'vmess':
      return {
        label: 'Vmess',
        className: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
      }
    case 'vless':
      return {
        label: 'Vless',
        className: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      }
    case 'trojan':
      return {
        label: 'Trojan',
        className: 'bg-fuchsia-500/10 text-fuchsia-500 border-fuchsia-500/20',
      }
    case 'hysteria2':
    case 'hy2':
      return {
        label: 'Hy2',
        className: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
      }
    case 'tuic':
      return {
        label: 'Tuic',
        className: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
      }
    case 'snell':
      return {
        label: 'Snell',
        className: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
      }
    case 'socks5':
      return {
        label: 'Socks5',
        className: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
      }
    case 'http':
      return {
        label: 'Http',
        className: 'bg-neutral-500/10 text-neutral-500 border-neutral-500/20',
      }
    default:
      return {
        label: formatProtocolName(type),
        className: 'bg-secondary text-muted-foreground border-border',
      }
  }
}

export function lookupNodeEgressInfo(
  nodeEgressIps: Record<string, DirectEgressInfo>,
  nodeName: string,
  profileId?: string | null,
  runtimeKey?: string,
): DirectEgressInfo | null {
  if (runtimeKey && nodeEgressIps[runtimeKey]) {
    return nodeEgressIps[runtimeKey]
  }
  if (profileId && nodeEgressIps[`${profileId}_${nodeName}`]) {
    return nodeEgressIps[`${profileId}_${nodeName}`]
  }
  return nodeEgressIps[nodeName] || null
}

export function isNodeEgressProbing(
  probingEgressNodeKeys: Record<string, boolean>,
  nodeName: string,
  profileId?: string | null,
  runtimeKey?: string,
): boolean {
  return Boolean(
    (runtimeKey && probingEgressNodeKeys[runtimeKey]) ||
      (profileId && probingEgressNodeKeys[`${profileId}_${nodeName}`]) ||
      probingEgressNodeKeys[nodeName],
  )
}

export function getNodeQualityCacheKey(
  nodeName: string,
  profileId?: string | null,
  runtimeKey?: string,
): string {
  if (profileId) {
    return `${profileId}_${nodeName}`
  }
  return runtimeKey || nodeName
}
