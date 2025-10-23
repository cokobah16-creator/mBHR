// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary'
import './index.css'
import './i18n'

import { seed } from './db/seed'
import { seedDemo } from './db/seedMbhr'
import { seedGamificationData } from './db/gamification'
import { db } from './db/index'
import { safeOpenDb } from './db/safeOpen'
import { runMigrations } from './db/migrations/migration-runner'
import { log, error } from '@/lib/logger'

// Global error visibility
window.addEventListener('error', ev => console.error('[global error]', ev.message, ev.error))
window.addEventListener('unhandledrejection', ev => console.error('[unhandledrejection]', ev.reason))

function renderFatal(msg: string) {
  const el = document.getElementById('root')
  if (el) {
    el.innerHTML = `
      <div style="font-family: system-ui; padding:24px; max-width:720px; margin:40px auto;">
        <h1 style="margin:0 0 12px;color:#0A7A3B;">Med Bridge Health Reach</h1>
        <h2 style="margin:0 0 16px;">Startup error</h2>
        <p style="margin:0 0 8px;">${msg}</p>
        <p style="color:#555">Open the browser console for details.</p>
      </div>
    `
  }
}

;(async () => {
  try {
    log('[db] opening…')
    await safeOpenDb()
    log('[db] opened OK')

    // Run database migrations (disabled until meta table exists)
    // log('[migrations] checking for pending migrations…')
    // await runMigrations()
    // log('[migrations] complete')

    // Check if database is working
    const patientCount = await db.patients.count()
    const userCount = await db.users.count()
    log('[db] Current counts - Patients:', patientCount, 'Users:', userCount)
  } catch (e) {
    error('Failed to initialize database:', e)
    renderFatal('Could not open the local database.')
    return
  }

  try {
    log('[seed] starting…')
    await seed()
    await seedDemo()
    await seedGamificationData()
    log('[seed] done')
  } catch (e: any) {
    error('[seed] failed', e)
    // Don't fail the app if seeding fails, just log it
    log('Seeding failed but continuing with app startup')
  }

  log('Application fully initialized and rendered.')
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  root.render(
    <React.StrictMode>
      <GlobalErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </GlobalErrorBoundary>
    </React.StrictMode>
  )
})()