// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import './i18n'

import { seed } from './db/seed'
import { db } from './db/index'
import { safeOpenDb } from './db/safeOpen'

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
    console.log('[db] opening…')
    await safeOpenDb()
    console.log('[db] opened OK')
    
    // Check if database is working
    const patientCount = await db.patients.count()
    const userCount = await db.users.count()
    console.log('[db] Current counts - Patients:', patientCount, 'Users:', userCount)
  } catch (e) {
    console.error('Failed to initialize database:', e)
    renderFatal('Could not open the local database.')
    return
  }

  try {
    console.log('[seed] starting…')
    await seed()
    console.log('[seed] done')
  } catch (e: any) {
    console.error('[seed] failed', e)
    // Don't fail the app if seeding fails, just log it
    console.warn('Seeding failed but continuing with app startup')
  }

  console.log('Application fully initialized and rendered.')
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
})()