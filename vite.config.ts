import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React libraries
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Form libraries
          'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
          // UI libraries
          'ui-vendor': ['@headlessui/react', '@heroicons/react'],
          // Database libraries
          'db-vendor': ['dexie', 'dexie-react-hooks', 'idb-keyval'],
          // Internationalization
          'i18n-vendor': ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
          // State management
          'state-vendor': ['zustand'],
          // Supabase
          'supabase-vendor': ['@supabase/supabase-js'],
          // Gamification features (lazy loaded)
          'gamification': [
            './src/features/gamification/Leaderboard',
            './src/features/gamification/QueueMaestro',
            './src/features/gamification/KnowledgeBlitz',
            './src/features/gamification/ApprovalInbox',
            './src/features/gamification/VitalsPrecision'
          ],
          // Analytics (admin only)
          'analytics': ['./src/features/analytics/AnalyticsDashboard'],
          // Pharmacy features
          'pharmacy': [
            './src/features/pharmacy/PharmacyStock',
            './src/features/pharmacy/RxForm',
            './src/features/pharmacy/Dispense',
            './src/features/pharmacy/EnhancedPharmacy',
            './src/features/pharmacy/FEFODispenser'
          ]
        }
      }
    },
    chunkSizeWarningLimit: 1000
  },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : []
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,mp3}'],
        maximumFileSizeToCacheInBytes: 3000000
      },
      manifest: {
        name: 'Med Bridge Health Reach',
        short_name: 'MBHR',
        description: 'Offline-first medical outreach platform',
        theme_color: '#0A7A3B',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
})