import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// GitHub Actions sets CI=true (some jobs set CI=1).
const isCI = !!process.env.CI && !['false', '0'].includes(process.env.CI)

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // On CI, run test files one at a time in a single forked worker. The
    // default parallel pool intermittently crashed the whole run on GitHub
    // runners (a worker exited while the main process was still sending to
    // it: "Channel closed" / "write EPIPE"). Local runs stay parallel.
    ...(isCI
      ? {
          pool: 'forks' as const,
          fileParallelism: false,
          maxWorkers: 1,
        }
      : {}),
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.{idea,git,cache,output,temp}/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/dist/**',
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
