import { useCallback, useEffect, useState } from 'react'
import { db } from '@/db'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatTile } from '@/features/reports/StatTile'
import { DataScopeNote } from '@/features/reports/DataScopeNote'
import { countInRange } from '@/features/reports/localRecords'
import { addLocalDays, startOfLocalDay } from '@/features/reports/reportUtils'
import {
  UsersIcon,
  UserPlusIcon,
  ClockIcon,
  HeartIcon,
  DocumentTextIcon,
  BeakerIcon,
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
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const today = startOfLocalDay(new Date())
      const tomorrow = addLocalDays(today, 1)

      const [
        totalPatients,
        todayRegistrations,
        activeVisits,
        vitalsRecorded,
        consultationsToday,
        medicationsDispensed,
      ] = await Promise.all([
        db.patients.count(),
        countInRange(db.patients, 'createdAt', today, tomorrow),
        db.visits.where('status').equals('open').count(),
        countInRange(db.vitals, 'takenAt', today, tomorrow),
        countInRange(db.consultations, 'createdAt', today, tomorrow),
        countInRange(db.dispenses, 'dispensedAt', today, tomorrow),
      ])

      setStats({
        totalPatients,
        todayRegistrations,
        activeVisits,
        vitalsRecorded,
        consultationsToday,
        medicationsDispensed,
      })
      setFailed(false)
    } catch (error) {
      console.error('Error loading stats:', error instanceof Error ? error.name : error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <span role="status" className="sr-only">Loading figures</span>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel space-y-2 p-4" aria-hidden>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-14" />
          </div>
        ))}
      </div>
    )
  }

  if (failed || !stats) {
    return (
      <div className="banner banner-danger" role="alert">
        The figures could not be read from this device. Reload the page to try again.
      </div>
    )
  }

  const statCards = [
    { name: 'Patient records', value: stats.totalPatients, hint: 'All time', icon: UsersIcon },
    { name: 'Registered', value: stats.todayRegistrations, hint: 'Today', icon: UserPlusIcon },
    { name: 'Open visits', value: stats.activeVisits, hint: 'Right now', icon: ClockIcon },
    { name: 'Vitals recorded', value: stats.vitalsRecorded, hint: 'Today', icon: HeartIcon },
    { name: 'Consultations', value: stats.consultationsToday, hint: 'Today', icon: DocumentTextIcon },
    { name: 'Dispensing records', value: stats.medicationsDispensed, hint: 'Today', icon: BeakerIcon },
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {statCards.map((stat) => (
          <StatTile
            key={stat.name}
            label={stat.name}
            value={stat.value.toLocaleString('en-NG')}
            hint={stat.hint}
            icon={stat.icon}
          />
        ))}
      </div>
      <DataScopeNote />
    </div>
  )
}
