import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/Layout'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { useAuthStore } from '@/stores/auth'

// Placeholder components for routes
const Register = () => <div className="p-6">Patient Registration - Coming Soon</div>
const Patients = () => <div className="p-6">Patients List - Coming Soon</div>
const Queue = () => <div className="p-6">Queue Management - Coming Soon</div>
const Inventory = () => <div className="p-6">Inventory - Coming Soon</div>
const Vitals = () => <div className="p-6">Vitals Recording - Coming Soon</div>
const Consult = () => <div className="p-6">Consultation - Coming Soon</div>
const Pharmacy = () => <div className="p-6">Pharmacy - Coming Soon</div>

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
                  <Route path="/patients/:id" element={<div>Patient Details</div>} />
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