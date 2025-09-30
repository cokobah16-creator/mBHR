import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { safeOpenDb } from './db/safeOpen'
import { syncNow, isOnlineSyncEnabled } from './sync/adapter'
import { seed } from './db/seed'
import { BrowserRouter } from 'react-router-dom'
import { safeOpenDb } from './db/safeOpen'
import { syncNow, isOnlineSyncEnabled } from './sync/adapter'
import { seed } from './db/seed'
import App from './App'
import './index.css'
import './i18n'

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration)
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError)
      })
  })
}

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration)
      })
      .catch((registrationError) => {
        console.log('SW registration failed: ', registrationError)
      })
  })
}

// --- helpers ----------------------------------------------------
async function safeOpenDbWithLogging(): Promise<boolean> {
  try {
    console.log('[db] opening…')
    await safeOpenDb()
    console.log('[db] opened OK')
    return true
  } catch (e) {
    console.error('[db] open failed', e)
        <p style="margin:0 0 8px;">${message}</p>
        <p style="color:#555">Open the browser console for details.</p>
      </div>
    `
  }
}

// --- global error visibility -----------------------------------
window.addEventListener('error', ev => {
  console.error('[global error]', ev.message, ev.error)
})
window.addEventListener('unhandledrejection', ev => {
  console.error('[unhandledrejection]', ev.reason)
})

// --- boot -------------------------------------------------------
;(async () => {
  const ok = await safeOpenDbWithLogging().catch(err => {
    console.error('Failed to initialize database:', err)
    alert('Failed to initialize database. See console for details.')
    return false
  })

  if (!ok) {
    alert('Could not open the local database. See console for details.')
    renderFatal('Could not open the local database.')
    return
  }

  try {
    console.log('[seed] starting…')
    await seed()
    console.log('[seed] done')
  } catch (e: any) {
    console.error('[seed] failed', e)
    alert(`Seeding failed: ${e?.message || e}`)
  }

  // Auto-sync on app boot if online sync is enabled
  if (isOnlineSyncEnabled()) {
    syncNow().catch(error => {
      console.log('Initial sync failed:', error)
    })
  }

  // Auto-sync on app boot if online sync is enabled
  if (isOnlineSyncEnabled()) {
    syncNow().catch(error => {
      console.log('Initial sync failed:', error)
    })
  }

  console.log('Application fully initialized and rendered.')
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  )
})()