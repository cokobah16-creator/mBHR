import React from 'react'
import { useT } from '@/hooks/useT'
import { 
  UserPlusIcon, 
  HeartIcon, 
  DocumentTextIcon, 
  BeakerIcon,
  QueueListIcon 
} from '@heroicons/react/24/outline'

interface SimpleModeProps {
  onActionSelect: (action: string) => void
}

export function SimpleMode({ onActionSelect }: SimpleModeProps) {
  const { t, speak } = useT()

  const actions = [
    {
      id: 'register',
      icon: UserPlusIcon,
      color: 'bg-blue-500 hover:bg-blue-600',
      textKey: 'action.register' as const,
      audioKey: 'action.register' as const
    },
    {
      id: 'vitals',
      icon: HeartIcon,
      color: 'bg-green-500 hover:bg-green-600',
      textKey: 'action.vitals' as const,
      audioKey: 'action.vitals' as const
    },
    {
      id: 'consult',
      icon: DocumentTextIcon,
      color: 'bg-purple-500 hover:bg-purple-600',
      textKey: 'action.consult' as const,
      audioKey: 'action.consult' as const
    },
    {
      id: 'pharmacy',
      icon: BeakerIcon,
      color: 'bg-orange-500 hover:bg-orange-600',
      textKey: 'action.pharmacy' as const,
      audioKey: 'action.pharmacy' as const
    },
    {
      id: 'queue',
      icon: QueueListIcon,
      color: 'bg-indigo-500 hover:bg-indigo-600',
      textKey: 'action.queue' as const,
      audioKey: 'action.queue' as const
    }
  ]

  const handleActionClick = async (action: typeof actions[0]) => {
    // Play audio prompt
    try {
      await speak(action.audioKey)
    } catch (error) {
      console.warn('Audio playback failed:', error)
    }
    
    onActionSelect(action.id)
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {t('app.title')}
        </h1>
        <p className="text-lg text-gray-600">
          {t('simple.chooseAction')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={() => handleActionClick(action)}
            className={`${action.color} text-white rounded-2xl p-8 text-center transition-all hover:scale-105 transform group touch-target-large shadow-lg`}
          >
            <action.icon className="h-16 w-16 mx-auto mb-4 group-hover:scale-110 transition-transform" />
            <div className="text-xl font-bold mb-2">
              {t(action.textKey)}
            </div>
            <div className="text-sm opacity-90">
              {t(`${action.textKey}.description` as any)}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-8 text-center">
        <p className="text-sm text-gray-500">
          {t('simple.tapToHear')}
        </p>
      </div>
    </div>
  )
}