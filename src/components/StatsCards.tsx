import React, { useEffect, useState } from 'react'
import { db } from '@/db'
import { 
  UsersIcon,
  UserPlusIcon,
  ClockIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon
} from '@heroicons/react/24/outline'

interface Stats {
  totalPatients: number
  todayRegistrations: number
  activeVisits: number
  vitalsRecorded: number
  consultationsToday: number
  medicationsDispensed: number
}

export function StatsCards() {
  const [stats, setStats] = useState<Stats>({
    totalPatients: 0,
    todayRegistrations: 0,
    activeVisits: 0,
    vitalsRecorded: 0,
    consultationsToday: 0,
    medicationsDispensed: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const [
        totalPatients,
        todayRegistrations,
        activeVisits,
        vitalsRecorded,
        consultationsToday,
        medicationsDispensed
      ] = await Promise.all([
        db.patients.count(),
        db.patients.where('createdAt').between(today, tomorrow).count(),
        db.visits.where('status').equals('open').count(),
        db.vitals.where('takenAt').between(today, tomorrow).count(),
        db.consultations.where('createdAt').between(today, tomorrow).count(),
        db.dispenses.where('dispensedAt').between(today, tomorrow).count()
      ])

      setStats({
        totalPatients,
        todayRegistrations,
        activeVisits,
        vitalsRecorded,
        consultationsToday,
        medicationsDispensed
      })
    } catch (error) {
      console.error('Error loading stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const statCards = [
    {
      name: 'Total Patients',
      value: stats.totalPatients,
      icon: UsersIcon,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50'
    },
    {
      name: "Today's Registrations",
      value: stats.todayRegistrations,
      icon: UserPlusIcon,
      color: 'text-green-600',
      bgColor: 'bg-green-50'
    },
    {
      name: 'Active Visits',
      value: stats.activeVisits,
      icon: ClockIcon,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50'
    },
    {
      name: 'Vitals Recorded',
      value: stats.vitalsRecorded,
      icon: HeartIcon,
      color: 'text-red-600',
      bgColor: 'bg-red-50'
    },
    {
      name: 'Consultations',
      value: stats.consultationsToday,
      icon: DocumentTextIcon,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50'
    },
    {
      name: 'Medications Dispensed',
      value: stats.medicationsDispensed,
      icon: BeakerIcon,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50'
    }
  ]

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm p-6 animate-pulse">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-8 w-8 bg-gray-200 rounded"></div>
              </div>
              <div className="ml-4 flex-1">
                <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                <div className="h-6 bg-gray-200 rounded w-16"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {statCards.map((stat) => (
        <div key={stat.name} className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow">
          <div className="flex items-center">
            <div className={`flex-shrink-0 p-2 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`h-6 w-6 ${stat.color}`} />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">{stat.name}</p>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}