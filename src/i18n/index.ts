import { useCallback } from 'react'
import { create } from 'zustand'
import { enUS } from './locales/en-US'
import { type TranslationKey, zhCN } from './locales/zh-CN'
import type { Locale, LocalePreference, TranslationParams } from './types'

export type { Locale, LocalePreference, TranslationKey, TranslationParams }

const LOCALE_STORAGE_KEY = 'mihomo_multi_locale'

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

function detectSystemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en-US'
  try {
    const language = new Intl.Locale(navigator.language)
    return language.language === 'zh' && language.maximize().script === 'Hans'
      ? 'zh-CN'
      : 'en-US'
  } catch {
    return 'en-US'
  }
}

function detectInitialPreference(): LocalePreference {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    return saved === 'zh-CN' || saved === 'en-US' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function syncDocumentLang(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

interface I18nState {
  locale: Locale
  localePreference: LocalePreference
  setLocale: (preference: LocalePreference) => void
}

const initialPreference = detectInitialPreference()
const initialLocale =
  initialPreference === 'system' ? detectSystemLocale() : initialPreference
syncDocumentLang(initialLocale)

export const useI18nStore = create<I18nState>()((set) => ({
  locale: initialLocale,
  localePreference: initialPreference,
  setLocale: (preference) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, preference)
    } catch {
      // Storage may be unavailable; keep the selection for this session.
    }
    const locale = preference === 'system' ? detectSystemLocale() : preference
    syncDocumentLang(locale)
    set({ locale, localePreference: preference })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (useI18nStore.getState().localePreference !== 'system') return
    const locale = detectSystemLocale()
    syncDocumentLang(locale)
    useI18nStore.setState({ locale })
  })
}

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
  const localePreference = useI18nStore((state) => state.localePreference)
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
    localePreference,
    setLocale,
  }
}
