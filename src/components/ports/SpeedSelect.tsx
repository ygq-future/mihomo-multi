import { Gauge, Loader2 } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { Select, type SelectOption, type SelectProps } from '../common/Select'

interface SpeedSelectProps extends SelectProps<string> {
  testOption?: (option: SelectOption<string>) => Promise<void>
  testOptions?: (options: SelectOption<string>[]) => Promise<void>
  isTesting?: boolean
  testingValues?: Record<string, boolean>
  renderOptionStatus?: (option: SelectOption<string>) => React.ReactNode
}

export function SpeedSelect({
  testOption,
  testOptions,
  isTesting,
  testingValues,
  renderOptionStatus,
  ...props
}: SpeedSelectProps) {
  const { t } = useTranslation()
  return (
    <Select
      {...props}
      renderOptionAction={(option) =>
        option.value && testOption ? (
          <div className="ml-1 flex items-center gap-1.5 shrink-0">
            {renderOptionStatus?.(option)}
            <button
              type="button"
              aria-label={`${t('proxies.testSingleTitle')}: ${option.label}`}
              title={t('proxies.testSingleTitle')}
              disabled={
                props.disabled ||
                isTesting ||
                Boolean(testingValues?.[option.value])
              }
              onClick={(event) => {
                event.stopPropagation()
                void testOption(option)
              }}
              className="shrink-0 min-h-6 min-w-6 px-1.5 flex items-center justify-center rounded hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              {testingValues?.[option.value] ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                option.rightNode || (
                  <span className="text-xs text-muted-foreground">--</span>
                )
              )}
            </button>
          </div>
        ) : (
          option.rightNode
        )
      }
      renderAppend={(options, focusSearch) =>
        testOptions && (
          <button
            type="button"
            aria-label={t('proxies.testVisible')}
            title={t('proxies.testVisible')}
            disabled={
              props.disabled ||
              isTesting ||
              !options.some((option) => Boolean(option.value))
            }
            onClick={() => {
              focusSearch()
              void testOptions(
                options.filter((option) => Boolean(option.value)),
              )
            }}
            className="px-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Gauge className="w-4 h-4" />
            )}
          </button>
        )
      }
    />
  )
}
