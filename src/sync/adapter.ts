// Sync adapter for cloud synchronization (stub implementation)

interface SyncCursor {
  lastSync: string
  version: number
}

interface LocalChange {
  id: string
  table: string
  operation: 'insert' | 'update' | 'delete'
  data: any
  timestamp: string
}

interface RemoteChange {
  id: string
  table: string
  operation: 'insert' | 'update' | 'delete'
  data: any
  timestamp: string
}

class SyncAdapter {
  private isOnline: boolean = navigator.onLine
  private supabaseUrl: string | undefined
  private supabaseKey: string | undefined

  constructor() {
    this.supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    this.supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true
      console.log('Sync adapter: Online')
    })
    
    window.addEventListener('offline', () => {
      this.isOnline = false
      console.log('Sync adapter: Offline')
    })
  }

  async pushChanges(localChanges: LocalChange[]): Promise<void> {
    if (!this.isOnline || !this.supabaseUrl || !this.supabaseKey) {
      console.log('Sync adapter: Push skipped (offline or no config)', {
        isOnline: this.isOnline,
        hasConfig: !!(this.supabaseUrl && this.supabaseKey),
        changeCount: localChanges.length
      })
      return
    }

    try {
      console.log('Sync adapter: Pushing changes', localChanges)
      
      // TODO: Implement actual Supabase sync
      // For now, just log the payload
      
    } catch (error) {
      console.error('Sync adapter: Push failed', error)
      // Don't throw - sync failures should not break the app
    }
  }

  async pullChanges(sinceCursor?: SyncCursor): Promise<RemoteChange[]> {
    if (!this.isOnline || !this.supabaseUrl || !this.supabaseKey) {
      console.log('Sync adapter: Pull skipped (offline or no config)')
      return []
    }

    try {
      console.log('Sync adapter: Pulling changes since', sinceCursor)
      
      // TODO: Implement actual Supabase sync
      // For now, return empty set
      
      return []
      
    } catch (error) {
      console.error('Sync adapter: Pull failed', error)
      return []
    }
  }

  async getCursor(): Promise<SyncCursor | null> {
    // TODO: Get cursor from IndexedDB
    return null
  }

  async setCursor(cursor: SyncCursor): Promise<void> {
    // TODO: Store cursor in IndexedDB
    console.log('Sync adapter: Setting cursor', cursor)
  }

  isConfigured(): boolean {
    return !!(this.supabaseUrl && this.supabaseKey)
  }

  getStatus(): 'online' | 'offline' | 'unconfigured' {
    if (!this.isConfigured()) return 'unconfigured'
    return this.isOnline ? 'online' : 'offline'
  }
}

export const syncAdapter = new SyncAdapter()