import { useToast } from '@/stores/toast'
import { XMarkIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline'

export default function Toasts() {
  const { items, remove } = useToast()

  const getToastStyles = (type: string = 'info') => {
    switch (type) {
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800'
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800'
      case 'success':
        return 'bg-green-50 border-green-200 text-green-800'
      default:
        return 'bg-blue-50 border-blue-200 text-blue-800'
    }
  }

  const getIcon = (type: string = 'info') => {
    switch (type) {
      case 'warning':
      case 'error':
        return <ExclamationTriangleIcon className="h-5 w-5" />
      default:
        return <InformationCircleIcon className="h-5 w-5" />
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {items.map(t => (
        <div 
          key={t.id} 
          className={`rounded-lg border p-4 shadow-lg animate-in slide-in-from-right ${getToastStyles(t.type)}`}
        >
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              {getIcon(t.type)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium">{t.title}</div>
              {t.body && <div className="text-sm opacity-90 mt-1">{t.body}</div>}
            </div>
            <button
              onClick={() => remove(t.id)}
              className="flex-shrink-0 p-1 rounded-full hover:bg-black/10 transition-colors"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}