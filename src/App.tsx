import React from 'react'
import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import RequireRoles from '@/components/RequireRoles'
import Login from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Register } from '@/pages/Register'
import { Patients } from '@/pages/Patients'
import { PatientDetail } from '@/pages/PatientDetail'
import { Queue } from '@/pages/Queue'
import { Vitals } from '@/pages/Vitals'
import { Consult } from '@/pages/Consult'
import { Pharmacy } from '@/pages/Pharmacy'
import { Inventory } from '@/pages/Inventory'
import { Users } from '@/pages/Users'
import { useAuthStore } from '@/stores/auth'
import RestockGame from '@/features/inventory/RestockGame'
import PrizeShop from '@/features/inventory/PrizeShop'
import PharmacyStock from '@/features/pharmacy/PharmacyStock'
import RxForm from '@/features/pharmacy/RxForm'
import Dispense from '@/features/pharmacy/Dispense'
import QueueBoard from '@/features/tickets/QueueBoard'
import TicketIssuer from '@/features/tickets/TicketIssuer'
import Leaderboard from '@/features/gamification/Leaderboard'
import PublicDisplay from '@/features/tickets/PublicDisplay'
import { QuestBoard } from '@/components/QuestBoard'
import QueueMaestro from '@/features/gamification/QueueMaestro'
import { seedDemo } from '@/db/seedMbhr'
import { useEffect } from 'react'
import { GameHub } from '@/components/GameHub'
import KnowledgeBlitz from '@/features/gamification/KnowledgeBlitz'
import AnalyticsDashboard from '@/features/analytics/AnalyticsDashboard'
import ApprovalInbox from '@/features/gamification/ApprovalInbox'
import { SimpleRegister } from '@/pages/SimpleRegister'
import FEFODispenser from '@/features/pharmacy/FEFODispenser'
import EnhancedPharmacy from '@/features/pharmacy/EnhancedPharmacy'

// Lazy load game components
const TriageSprint = lazy(() => import('@/features/triage/TriageSprint'))
const VitalsPrecisionGame = lazy(() => import('@/features/vitals/VitalsPrecisionGame'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

function App() {
  useEffect(() => { 
    seedDemo().catch(console.error)
  }, [])
  
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading...</p>
                  </div>
                </div>
              }>
                <Layout>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/patients" element={<Patients />} />
                    <Route path="/patients/:id" element={<PatientDetail />} />
                    <Route path="/queue" element={<Queue />} />
                    <Route path="/inventory" element={<Inventory />} />
                    <Route path="/users" element={<Users />} />
                    <Route path="/vitals" element={<Vitals />} />
                    <Route path="/vitals/:visitId" element={<Vitals />} />
                    <Route path="/consult" element={<Consult />} />
                    <Route path="/consult/:visitId" element={<Consult />} />
                    <Route path="/pharmacy" element={<Pharmacy />} />
                    <Route path="/pharmacy/:visitId" element={<Pharmacy />} />
                    
                    {/* New MBHR Features */}
                    <Route path="/inv/game" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <RestockGame />
                      </RequireRoles>
                    } />
                    <Route path="/inv/prizes" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <PrizeShop />
                      </RequireRoles>
                    } />
                    <Route path="/rx/stock" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <PharmacyStock />
                      </RequireRoles>
                    } />
                    <Route path="/rx/new" element={
                      <RequireRoles roles={['doctor', 'nurse', 'admin']}>
                        <RxForm />
                      </RequireRoles>
                    } />
                    <Route path="/rx/dispense" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <Dispense />
                      </RequireRoles>
                    } />
                    <Route path="/tickets/queue" element={
                      <RequireRoles roles={['nurse', 'doctor', 'admin']}>
                        <QueueBoard />
                      </RequireRoles>
                    } />
                    <Route path="/tickets/issue" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'doctor', 'admin']}>
                        <TicketIssuer />
                      </RequireRoles>
                    } />
                    <Route path="/inv/leaderboard" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <Leaderboard />
                      </RequireRoles>
                    } />
                    <Route path="/display" element={<PublicDisplay />} />
                    <Route path="/quests" element={<QuestBoard />} />
                    <Route path="/games/queue-maestro" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <QueueMaestro />
                      </RequireRoles>
                    } />
                    <Route path="/games" element={<GameHub />} />
                    <Route path="/games/vitals-precision" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <VitalsPrecisionGame />
                      </RequireRoles>
                    } />
                    <Route path="/games/knowledge-blitz" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <KnowledgeBlitz />
                      </RequireRoles>
                    } />
                    <Route path="/games/triage-sprint" element={
                      <RequireRoles roles={['nurse', 'doctor', 'admin']}>
                        <TriageSprint />
                      </RequireRoles>
                    } />
                    <Route path="/games/vitals-precision-enhanced" element={
                      <RequireRoles roles={['volunteer', 'nurse', 'admin']}>
                        <VitalsPrecisionGame />
                      </RequireRoles>
                    } />
                    <Route path="/analytics" element={
                      <RequireRoles roles={['admin']}>
                        <AnalyticsDashboard />
                      </RequireRoles>
                    } />
                    <Route path="/admin/approvals" element={
                      <RequireRoles roles={['admin']}>
                        <ApprovalInbox />
                      </RequireRoles>
                    } />
                    <Route path="/simple/register" element={<SimpleRegister />} />
                    <Route path="/pharmacy/enhanced/:visitId" element={
                      <RequireRoles roles={['pharmacist', 'admin']}>
                        <EnhancedPharmacy patientId="" visitId="" onSuccess={() => {}} />
                      </RequireRoles>
                    } />
                    <Route path="/triage/quick" element={
                      <RequireRoles roles={['nurse', 'doctor', 'admin']}>
                        <QuickTriage onComplete={() => {}} />
                      </RequireRoles>
                    } />
                  </Routes>
                </Layout>
              </Suspense>
            </ProtectedRoute>
          }
        />
      </Routes>
    </ErrorBoundary>
  )
}

export default App