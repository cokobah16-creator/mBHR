import React, { useEffect, useState } from 'react'
import { db, Patient, Vital, Consultation, Dispense } from '@/db'
import { 
  HeartIcon, 
  DocumentTextIcon, 
  BeakerIcon,
  UserIcon
} from '@heroicons/react/24/outline'

interface ActivityItem {
  id: string
  type: 'vital' | 'consultation' | 'dispense'
  patientName: string
  timestamp: Date
  details: string
}

export function RecentActivity() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRecentActivity()
  }, [])

  const loadRecentActivity = async () => {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Get recent vitals, consultations, and dispenses
      const [vitals, consultations, dispenses] = await Promise.all([
        db.vitals.where('takenAt').above(today).reverse().limit(10).toArray(),
        db.consultations.where('createdAt').above(today).reverse().limit(10).toArray(),
        db.dispenses.where('dispensedAt').above(today).reverse().limit(10).toArray()
      ])

      // Get patient names for each activity
      const activities: ActivityItem[] = []

      for (const vital of vitals) {
        const patient = await db.patients.get(vital.patientId)
        if (patient) {
          activities.push({
            id: vital.id,
            type: 'vital',
            patientName: `${patient.givenName} ${patient.familyName}`,
            timestamp: vital.takenAt,
            details: `BP: ${vital.systolic}/${vital.diastolic}, HR: ${vital.pulseBpm}`
          })
        }
      }

      for (const consultation of consultations) {
        const patient = await db.patients.get(consultation.patientId)
        if (patient) {
          activities.push({
            id: consultation.id,
            type: 'consultation',
            patientName: `${patient.givenName} ${patient.familyName}`,
            timestamp: consultation.createdAt,
            details: `Provider: ${consultation.providerName}`
          })
        }
      }

      for (const dispense of dispenses) {
        const patient = await db.patients.get(dispense.patientId)
        if (patient) {
          activities.push({
            id: dispense.id,
            type: 'dispense',
            patientName: `${patient.givenName} ${patient.familyName}`,
            timestamp: dispense.dispensedAt,
            details: `${dispense.itemName} x${dispense.qty}`
          })
        }
      }

      // Sort by timestamp and take most recent 10
      activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      setActivities(activities.slice(0, 10))
    } catch (error) {
      console.error('Error loading recent activity:', error)
    } finally {
      setLoading(false)
    }
  }

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'vital':
        return HeartIcon
      case 'consultation':
        return DocumentTextIcon
      case 'dispense':
        return BeakerIcon
      default:
        return UserIcon
    }
  }

  const getActivityColor = (type: ActivityItem['type']) => {
    switch (type) {
      case 'vital':
        return 'text-green-600 bg-green-50'
      case 'consultation':
        return 'text-purple-600 bg-purple-50'
      case 'dispense':
        return 'text-orange-600 bg-orange-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center space-x-3 p-3 animate-pulse">
            <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
              <div className="h-3 bg-gray-200 rounded w-48"></div>
            </div>
            <div className="h-3 bg-gray-200 rounded w-12"></div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {activities.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <UserIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No recent activity</p>
        </div>
      ) : (
        activities.map((activity) => {
          const Icon = getActivityIcon(activity.type)
          const colorClass = getActivityColor(activity.type)
          
          return (
            <div key={activity.id} className="flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-lg transition-colors">
              <div className={`p-2 rounded-full ${colorClass}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {activity.patientName}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {activity.details}
                </p>
              </div>
              <div className="text-xs text-gray-400">
                {formatTime(activity.timestamp)}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}