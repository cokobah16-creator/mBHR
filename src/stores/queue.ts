import { create } from 'zustand'
import { db, QueueItem, Patient, generateId } from '@/db'

interface QueueState {
  queueItems: (QueueItem & { patient?: Patient })[]
  
  // Actions
  loadQueue: () => Promise<void>
  moveToNextStage: (patientId: string) => Promise<void>
  updateQueueStatus: (patientId: string, status: QueueItem['status']) => Promise<void>
  getQueueByStage: (stage: QueueItem['stage']) => (QueueItem & { patient?: Patient })[]
}

export const useQueueStore = create<QueueState>((set, get) => ({
  queueItems: [],

  loadQueue: async () => {
    try {
      const items = await db.queue
        .orderBy('position')
        .toArray()
      
      // Load patient data for each queue item
      const itemsWithPatients = await Promise.all(
        items.map(async (item) => {
          const patient = await db.patients.get(item.patientId)
          return { ...item, patient }
        })
      )
      
      set({ queueItems: itemsWithPatients })
    } catch (error) {
      console.error('Error loading queue:', error)
    }
  },

  moveToNextStage: async (patientId: string) => {
    try {
      const currentItem = await db.queue
        .where('patientId')
        .equals(patientId)
        .first()
      
      if (!currentItem) return
      
      const stageOrder: QueueItem['stage'][] = ['registration', 'vitals', 'consult', 'pharmacy']
      const currentIndex = stageOrder.indexOf(currentItem.stage)
      
      if (currentIndex < stageOrder.length - 1) {
        const nextStage = stageOrder[currentIndex + 1]
        
        await db.queue.update(currentItem.id, {
          stage: nextStage,
          status: 'waiting',
          updatedAt: new Date()
        })
        
        get().loadQueue()
      } else {
        // Mark as done if at final stage
        await db.queue.update(currentItem.id, {
          status: 'done',
          updatedAt: new Date()
        })
        
        get().loadQueue()
      }
    } catch (error) {
      console.error('Error moving to next stage:', error)
    }
  },

  updateQueueStatus: async (patientId: string, status: QueueItem['status']) => {
    try {
      const item = await db.queue
        .where('patientId')
        .equals(patientId)
        .first()
      
      if (item) {
        await db.queue.update(item.id, {
          status,
          updatedAt: new Date()
        })
        
        get().loadQueue()
      }
    } catch (error) {
      console.error('Error updating queue status:', error)
    }
  },

  getQueueByStage: (stage: QueueItem['stage']) => {
    return get().queueItems.filter(item => item.stage === stage && item.status !== 'done')
  }
}))