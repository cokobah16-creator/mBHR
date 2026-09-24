import { PageHeader } from '@/components/ui/PageHeader'
import { SMSReminderManager } from '@/features/pharmacy/SMSReminderManager'

export default function SMSReminders() {
  return (
    <div>
      <PageHeader
        title="SMS reminders"
        breadcrumbs={[{ label: 'Pharmacy', to: '/pharmacy/menu' }, { label: 'SMS reminders' }]}
        description="Medication reminders for patients, where each one is stored and whether it has really been sent."
      />
      <SMSReminderManager />
    </div>
  )
}
