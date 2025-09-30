```tsx
import React from 'react'
import { useTranslation } from 'react-i18next'
import QueueBoard from '@/components/QueueBoard' // Changed to default import
import { QueueListIcon } from '@heroicons/react/24/outline'

export function Queue() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <QueueListIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('nav.queue')}
          </h1>
          <p className="text-gray-600">
            Manage patient flow through care stages
          </p>
        </div>
      </div>

      {/* Queue Overview */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Queue Overview</h2>
        <QueueBoard compact /> {/* This will now use the default stage 'registration' */}
      </div>

      {/* Detailed Queue - Render all stages */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">All Patients</h2>
        {(['registration', 'vitals', 'consult', 'pharmacy'] as const).map(s => (
          <QueueBoard key={s} stage={s} />
        ))}
      </div>
    </div>
  )
}
```