import { useToast, toastTone, type ToastTone } from '@/stores/toast'
import {
  CheckCircleIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/20/solid'

const TONE: Record<ToastTone, { Icon: typeof CheckCircleIcon; icon: string; border: string }> = {
  success: { Icon: CheckCircleIcon, icon: 'text-success', border: 'border-l-success' },
  info: { Icon: InformationCircleIcon, icon: 'text-info', border: 'border-l-info' },
  warning: { Icon: ExclamationTriangleIcon, icon: 'text-warning', border: 'border-l-warning' },
  error: { Icon: XCircleIcon, icon: 'text-danger', border: 'border-l-danger' },
}

export default function Toasts() {
  const items = useToast(s => s.items)
  const remove = useToast(s => s.remove)

  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-stretch gap-2 pb-safe-bottom sm:inset-x-auto sm:right-4 sm:w-96"
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.map(t => {
        const tone = toastTone(t)
        const { Icon, icon, border } = TONE[tone]
        return (
          <div
            key={t.id}
            role={tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border border-line border-l-4 ${border} bg-surface p-3 shadow-xl`}
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${icon}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-label font-semibold text-ink">{t.title}</div>
              {t.body && <div className="mt-0.5 text-body text-ink-secondary">{t.body}</div>}
            </div>
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="-m-1 rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
              aria-label="Dismiss notification"
            >
              <XMarkIcon className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}
