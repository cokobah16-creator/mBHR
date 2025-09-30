import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Register } from '@/pages/Register'
import { Patients } from '@/pages/Patients'
import { PatientDetail } from '@/pages/PatientDetail'
import { Queue } from '@/pages/Queue'
import { Vitals } from '@/pages/Vitals'
import { Consult } from '@/pages/Consult'
import { Pharmacy } from '@/pages/Pharmacy'
import { Inventory } from '@/pages/Inventory'
import { useAuthStore } from '@/stores/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/patients" element={<Patients />} />
                  <Route path="/patients/:id" element={<PatientDetail />} />
                  <Route path="/queue" element={<Queue />} />
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/vitals" element={<Vitals />} />
                  <Route path="/vitals/:visitId" element={<Vitals />} />
                  <Route path="/consult" element={<Consult />} />
                  <Route path="/consult/:visitId" element={<Consult />} />
                  <Route path="/pharmacy" element={<Pharmacy />} />
                  <Route path="/pharmacy/:visitId" element={<Pharmacy />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </ErrorBoundary>
  )
}

export default App