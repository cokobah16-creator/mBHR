import type { ComponentType, SVGProps } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { can, type Permission } from '@/auth/roles'
import {
  UserPlusIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
  QueueListIcon,
  CubeIcon,
} from '@heroicons/react/24/outline'

interface QuickAction {
  name: string
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  permission: Extract<Permission, 'register' | 'vitals' | 'consult' | 'dispense' | 'inventory'>
  description: string
  /** Stage marker for actions that belong to one step of the patient flow. */
  marker?: string
}

const ACTIONS: QuickAction[] = [
  {
    name: 'Register patient',
    href: '/register',
    icon: UserPlusIcon,
    permission: 'register',
    description: 'Add a new patient',
    marker: 'bg-stage-registration',
  },
  {
    name: 'View queue',
    href: '/queue',
    icon: QueueListIcon,
    permission: 'vitals',
    description: 'Who is waiting where',
  },
  {
    name: 'Record vitals',
    href: '/vitals',
    icon: HeartIcon,
    permission: 'vitals',
    description: 'Take measurements',
    marker: 'bg-stage-vitals',
  },
  {
    name: 'Consultation',
    href: '/consult',
    icon: DocumentTextIcon,
    permission: 'consult',
    description: 'Clinical notes',
    marker: 'bg-stage-consult',
  },
  {
    name: 'Pharmacy',
    href: '/pharmacy',
    icon: BeakerIcon,
    permission: 'dispense',
    description: 'Dispense medicines',
    marker: 'bg-stage-pharmacy',
  },
  {
    name: 'Inventory',
    href: '/inventory',
    icon: CubeIcon,
    permission: 'inventory',
    description: 'Stock on hand',
  },
]

export function QuickActions() {
  const currentUser = useAuthStore((s) => s.currentUser)
  const visible = ACTIONS.filter((a) => !!currentUser && can(currentUser.role, a.permission))

  if (visible.length === 0) return null

  return (
    <nav aria-label="Quick actions">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {visible.map((action) => (
          <li key={action.name}>
            <Link
              to={action.href}
              className="relative flex h-full min-h-touch-target flex-col items-start gap-1 overflow-hidden rounded-lg border border-line bg-surface p-4 pl-5 transition-colors hover:border-line-strong hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {action.marker && (
                <span className={`absolute inset-y-0 left-0 w-1 ${action.marker}`} aria-hidden />
              )}
              <action.icon className="h-5 w-5 text-ink-secondary" aria-hidden />
              <span className="text-label text-ink">{action.name}</span>
              <span className="text-caption text-ink-muted">{action.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
