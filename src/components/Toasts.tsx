import { useToast } from '@/stores/toast'

export default function Toasts() {
  const items = useToast(s => s.items)
  const remove = useToast(s => s.remove)
  
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map(t => (
        <div key={t.id} className="rounded-xl bg-white shadow-lg border p-3 w-80">
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <div className="font-medium">{t.title}</div>
              {t.body && <div className="text-sm opacity-70">{t.body}</div>}
            </div>
            <button 
              onClick={() => remove(t.id)}
              className="ml-2 text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}