import { useCallback } from 'react'
import { create } from 'zustand'
import { enUS } from './locales/en-US'
import { type TranslationKey, zhCN } from './locales/zh-CN'
import type { Locale, TranslationParams } from './types'

export type { Locale, TranslationKey, TranslationParams }

const LOCALE_STORAGE_KEY = 'mihomo_multi_locale'

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN'
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en-US') {
      return saved
    }
    const navLang = navigator.language?.toLowerCase() ?? ''
    return navLang.startsWith('zh') ? 'zh-CN' : 'en-US'
  } catch {
    return 'zh-CN'
  }
}

function syncDocumentLang(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

interface I18nState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

const initialLocale = detectInitialLocale()
syncDocumentLang(initialLocale)

export const useI18nStore = create<I18nState>()((set) => ({
  locale: initialLocale,
  setLocale: (locale: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    } catch {
      // ignore storage errors
    }
    syncDocumentLang(locale)
    set({ locale })
  },
}))

function formatMessage(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key]
    return value !== undefined ? String(value) : `{${key}}`
  })
}

export function t(key: TranslationKey, params?: TranslationParams): string {
  const locale = useI18nStore.getState().locale
  const dict = dictionaries[locale] ?? zhCN
  const template = dict[key] ?? zhCN[key] ?? key
  return formatMessage(template, params)
}

export function useTranslation() {
  const locale = useI18nStore((state) => state.locale)
  const setLocale = useI18nStore((state) => state.setLocale)

  const translate = useCallback(
    (key: TranslationKey, params?: TranslationParams): string => {
      const dict = dictionaries[locale] ?? zhCN
      const template = dict[key] ?? zhCN[key] ?? key
      return formatMessage(template, params)
    },
    [locale],
  )

  return {
    t: translate,
    locale,
    setLocale,
  }
}
