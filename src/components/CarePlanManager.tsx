import React, { useEffect, useState } from 'react'
import { useT } from '@/hooks/useT'
import { db, generateId } from '@/db'
import { getMessageService } from '@/services/messaging'
import { 
  ClipboardDocumentListIcon,
  PlusIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CalendarIcon
} from '@heroicons/react/24/outline'

interface CareTask {
  id: string
  patientId: string
  type: 'medication_reminder' | 'followup_visit' | 'lab_test' | 'vital_check'
  title: string
  description: string
  status: 'pending' | 'completed' | 'overdue' | 'cancelled'
  dueDate: Date
  completedAt?: Date
  createdAt: Date
  _dirty?: number
}

interface CarePlanManagerProps {
  patientId: string
  className?: string
}

export function CarePlanManager({ patientId, className = '' }: CarePlanManagerProps) {
  const { t } = useT()
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTask, setNewTask] = useState({
    type: 'medication_reminder' as CareTask['type'],
    title: '',
    description: '',
    dueDate: new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    loadCareTasks()
  }, [patientId])

  const loadCareTasks = async () => {
    try {
      const careTasks = await db.careTasks
        .where('patientId')
        .equals(patientId)
        .reverse()
        .toArray()
      
      // Update overdue status
      const now = new Date()
      const updatedTasks = careTasks.map(task => {
        if (task.status === 'pending' && task.dueDate < now) {
          return { ...task, status: 'overdue' as const }
        }
        return task
      })
      
      setTasks(updatedTasks)
    } catch (error) {
      console.error('Error loading care tasks:', error)
    } finally {
      setLoading(false)
    }
  }

  const addTask = async () => {
    if (!newTask.title.trim()) return

    try {
      const task: CareTask = {
        id: generateId(),
        patientId,
        type: newTask.type,
        title: newTask.title,
        description: newTask.description,
        status: 'pending',
        dueDate: new Date(newTask.dueDate),
        createdAt: new Date(),
        _dirty: 1
      }

      await db.careTasks.add(task)
      
      // Queue reminder if it's a medication reminder
      if (task.type === 'medication_reminder') {
        try {
          const messageService = getMessageService()
          await messageService.queueMedicationReminder(
            patientId,
            task.title,
            '1 dose',
            task.description,
            task.dueDate
          )
        } catch (error) {
          console.warn('Failed to queue reminder:', error)
        }
      }

      await loadCareTasks()
      setShowAddTask(false)
      setNewTask({
        type: 'medication_reminder',
        title: '',
        description: '',
        dueDate: new Date().toISOString().split('T')[0]
      })
    } catch (error) {
      console.error('Error adding care task:', error)
    }
  }

  const completeTask = async (taskId: string) => {
    try {
      await db.careTasks.update(taskId, {
        status: 'completed',
        completedAt: new Date(),
        _dirty: 1
      })
      await loadCareTasks()
    } catch (error) {
      console.error('Error completing task:', error)
    }
  }

  const getTaskIcon = (type: CareTask['type']) => {
    switch (type) {
      case 'medication_reminder':
        return BeakerIcon
      case 'followup_visit':
        return CalendarIcon
      case 'vital_check':
        return HeartIcon
      case 'lab_test':
        return ClipboardDocumentListIcon
      default:
        return ClockIcon
    }
  }

  const getTaskColor = (status: CareTask['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'overdue':
        return 'bg-red-100 text-red-800 border-red-200'
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 border-gray-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getStatusIcon = (status: CareTask['status']) => {
    switch (status) {
      case 'pending':
        return ClockIcon
      case 'completed':
        return CheckCircleIcon
      case 'overdue':
        return ExclamationTriangleIcon
      case 'cancelled':
        return ExclamationTriangleIcon
      default:
        return ClockIcon
    }
  }

  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="animate-pulse space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <ClipboardDocumentListIcon className="h-6 w-6 text-primary" />
          <h3 className="text-lg font-semibold text-gray-900">
            {t('careplan.title')}
          </h3>
        </div>
        
        <button
          onClick={() => setShowAddTask(true)}
          className="btn-primary inline-flex items-center space-x-2"
        >
          <PlusIcon className="h-4 w-4" />
          <span>{t('careplan.addTask')}</span>
        </button>
      </div>

      {/* Add Task Form */}
      {showAddTask && (
        <div className="card bg-blue-50 border-blue-200">
          <h4 className="text-lg font-medium text-gray-900 mb-4">
            {t('careplan.newTask')}
          </h4>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('careplan.taskType')}
              </label>
              <select
                value={newTask.type}
                onChange={(e) => setNewTask(prev => ({ ...prev, type: e.target.value as CareTask['type'] }))}
                className="input-field"
              >
                <option value="medication_reminder">{t('careplan.medicationReminder')}</option>
                <option value="followup_visit">{t('careplan.followupVisit')}</option>
                <option value="vital_check">{t('careplan.vitalCheck')}</option>
                <option value="lab_test">{t('careplan.labTest')}</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('careplan.taskTitle')} *
              </label>
              <input
                type="text"
                value={newTask.title}
                onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                className="input-field"
                placeholder={t('careplan.titlePlaceholder')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('careplan.description')}
              </label>
              <textarea
                value={newTask.description}
                onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                className="input-field"
                rows={3}
                placeholder={t('careplan.descriptionPlaceholder')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('careplan.dueDate')} *
              </label>
              <input
                type="date"
                value={newTask.dueDate}
                onChange={(e) => setNewTask(prev => ({ ...prev, dueDate: e.target.value }))}
                className="input-field"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            
            <div className="flex space-x-4">
              <button onClick={addTask} className="btn-primary">
                {t('careplan.addTask')}
              </button>
              <button 
                onClick={() => setShowAddTask(false)} 
                className="btn-secondary"
              >
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tasks List */}
      <div className="space-y-4">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <ClipboardDocumentListIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t('careplan.noTasks')}</p>
          </div>
        ) : (
          tasks.map((task) => {
            const TaskIcon = getTaskIcon(task.type)
            const StatusIcon = getStatusIcon(task.status)
            const taskColor = getTaskColor(task.status)
            
            return (
              <div key={task.id} className={`border rounded-lg p-4 ${taskColor}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <TaskIcon className="h-6 w-6 mt-1" />
                    <div>
                      <h4 className="font-medium text-gray-900">{task.title}</h4>
                      <p className="text-sm text-gray-700 mt-1">{task.description}</p>
                      <div className="flex items-center space-x-4 mt-2 text-sm text-gray-600">
                        <span>{t(`careplan.type.${task.type}`)}</span>
                        <span>Due: {task.dueDate.toLocaleDateString()}</span>
                        {task.completedAt && (
                          <span>Completed: {task.completedAt.toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${taskColor}`}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {t(`careplan.status.${task.status}`)}
                    </span>
                    
                    {task.status === 'pending' && (
                      <button
                        onClick={() => completeTask(task.id)}
                        className="bg-green-100 text-green-800 px-3 py-1 rounded-lg hover:bg-green-200 transition-colors text-sm"
                      >
                        {t('action.complete')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}