import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { safeOpenDb } from './db/safeOpen'
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

// Safe database initialization before render
safeOpenDb().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  )
}).catch(error => {
  console.error('Failed to initialize database:', error)
  // Render error state or fallback
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>Database Error</h1>
      <p>Failed to initialize the application database.</p>
      <button onClick={() => window.location.reload()}>Retry</button>
    </div>
  )
})