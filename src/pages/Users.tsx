import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { can, getRoleDisplayName } from '@/auth/roles'
import { UserManagement } from '@/components/UserManagement'
import { PageHeader } from '@/components/ui/PageHeader'
import { LockClosedIcon } from '@heroicons/react/24/outline'

const BREADCRUMBS = [
  { label: 'Administration', to: '/admin' },
  { label: 'Staff accounts' },
]

export function Users() {
  const currentUser = useAuthStore((s) => s.currentUser)

  // The /users route has no guard in App.tsx; this page enforces the
  // `users` permission itself (admin only in src/auth/roles.ts).
  if (!currentUser || !can(currentUser.role, 'users')) {
    return (
      <div>
        <PageHeader breadcrumbs={BREADCRUMBS} title="Staff accounts" />
        <div className="max-w-lg panel p-6" role="alert">
          <div className="flex items-start gap-3">
            <LockClosedIcon className="h-6 w-6 shrink-0 text-ink-muted" aria-hidden />
            <div>
              <h2 className="text-h2 text-ink">You can’t manage staff accounts</h2>
              <p className="mt-1 text-body text-ink-secondary">
                {currentUser
                  ? `Your role (${getRoleDisplayName(currentUser.role)}) cannot add or change staff accounts.`
                  : 'Sign in to continue.'}{' '}
                Ask an administrator if you need access.
              </p>
              <Link to="/dashboard" className="btn-secondary mt-4">
                Back to dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Staff accounts"
        description="Who can sign in on this device, their role and whether the account is active."
      />
      <UserManagement />
    </div>
  )
}
