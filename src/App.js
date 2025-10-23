import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Layout } from '@/components/Layout';
import RequireRoles from '@/components/RequireRoles';
import Login from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Register } from '@/pages/Register';
import { Patients } from '@/pages/Patients';
import { PatientDetail } from '@/pages/PatientDetail';
import { Queue } from '@/pages/Queue';
import { Vitals } from '@/pages/Vitals';
import { Consult } from '@/pages/Consult';
import { Pharmacy } from '@/pages/Pharmacy';
import { Inventory } from '@/pages/Inventory';
import { Users } from '@/pages/Users';
import { useAuthStore } from '@/stores/auth';
import RestockGame from '@/features/inventory/RestockGame';
import PrizeShop from '@/features/inventory/PrizeShop';
import PharmacyStock from '@/features/pharmacy/PharmacyStock';
import RxForm from '@/features/pharmacy/RxForm';
import Dispense from '@/features/pharmacy/Dispense';
import QueueBoard from '@/features/tickets/QueueBoard';
import TicketIssuer from '@/features/tickets/TicketIssuer';
import Leaderboard from '@/features/gamification/Leaderboard';
import PublicDisplay from '@/features/tickets/PublicDisplay';
import { QuestBoard } from '@/components/QuestBoard';
import QueueMaestro from '@/features/gamification/QueueMaestro';
import { seedDemo } from '@/db/seedMbhr';
import { useEffect } from 'react';
import { GameHub } from '@/components/GameHub';
import KnowledgeBlitz from '@/features/gamification/KnowledgeBlitz';
import AnalyticsDashboard from '@/features/analytics/AnalyticsDashboard';
import ApprovalInbox from '@/features/gamification/ApprovalInbox';
import { SimpleRegister } from '@/pages/SimpleRegister';
// Pharmacy menu components
const PharmacyMenu = lazy(() => import('@/pages/PharmacyMenu'));
const PharmacyReports = lazy(() => import('@/pages/PharmacyReports'));
// Lazy load game components with default exports
const TriageSprint = lazy(() => import('@/features/triage/TriageSprint'));
const VitalsPrecisionGame = lazy(() => import('@/features/vitals/VitalsPrecisionGame'));
const QuickTriage = lazy(() => import('@/features/triage/QuickTriage'));
const FEFODispenser = lazy(() => import('@/features/pharmacy/FEFODispenser'));
const EnhancedPharmacy = lazy(() => import('@/features/pharmacy/EnhancedPharmacy'));
function ProtectedRoute({ children }) {
    const { isAuthenticated } = useAuthStore();
    if (!isAuthenticated) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return _jsx(_Fragment, { children: children });
}
function App() {
    useEffect(() => {
        seedDemo().catch(console.error);
    }, []);
    return (_jsx(ErrorBoundary, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Login, {}) }), _jsx(Route, { path: "/*", element: _jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx("div", { className: "min-h-screen flex items-center justify-center", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading..." })] }) }), children: _jsx(Layout, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/register", element: _jsx(Register, {}) }), _jsx(Route, { path: "/patients", element: _jsx(Patients, {}) }), _jsx(Route, { path: "/patients/:id", element: _jsx(PatientDetail, {}) }), _jsx(Route, { path: "/queue", element: _jsx(Queue, {}) }), _jsx(Route, { path: "/inventory", element: _jsx(Inventory, {}) }), _jsx(Route, { path: "/users", element: _jsx(Users, {}) }), _jsx(Route, { path: "/vitals", element: _jsx(Vitals, {}) }), _jsx(Route, { path: "/vitals/:visitId", element: _jsx(Vitals, {}) }), _jsx(Route, { path: "/consult", element: _jsx(Consult, {}) }), _jsx(Route, { path: "/consult/:visitId", element: _jsx(Consult, {}) }), _jsx(Route, { path: "/pharmacy", element: _jsx(Pharmacy, {}) }), _jsx(Route, { path: "/pharmacy/:visitId", element: _jsx(Pharmacy, {}) }), _jsx(Route, { path: "/inv/game", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(RestockGame, {}) }) }), _jsx(Route, { path: "/inv/prizes", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(PrizeShop, {}) }) }), _jsx(Route, { path: "/rx/stock", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(PharmacyStock, {}) }) }), _jsx(Route, { path: "/rx/new", element: _jsx(RequireRoles, { roles: ['doctor', 'nurse', 'admin'], children: _jsx(RxForm, {}) }) }), _jsx(Route, { path: "/rx/dispense", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(Dispense, {}) }) }), _jsx(Route, { path: "/tickets/queue", element: _jsx(RequireRoles, { roles: ['nurse', 'doctor', 'admin'], children: _jsx(QueueBoard, {}) }) }), _jsx(Route, { path: "/tickets/issue", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'doctor', 'admin'], children: _jsx(TicketIssuer, {}) }) }), _jsx(Route, { path: "/inv/leaderboard", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(Leaderboard, {}) }) }), _jsx(Route, { path: "/display", element: _jsx(PublicDisplay, {}) }), _jsx(Route, { path: "/quests", element: _jsx(QuestBoard, {}) }), _jsx(Route, { path: "/games/queue-maestro", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(QueueMaestro, {}) }) }), _jsx(Route, { path: "/games", element: _jsx(GameHub, {}) }), _jsx(Route, { path: "/games/vitals-precision", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(VitalsPrecisionGame, {}) }) }), _jsx(Route, { path: "/games/knowledge-blitz", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(KnowledgeBlitz, {}) }) }), _jsx(Route, { path: "/games/triage-sprint", element: _jsx(RequireRoles, { roles: ['nurse', 'doctor', 'admin'], children: _jsx(TriageSprint, {}) }) }), _jsx(Route, { path: "/games/vitals-precision-enhanced", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(VitalsPrecisionGame, {}) }) }), _jsx(Route, { path: "/analytics", element: _jsx(RequireRoles, { roles: ['admin'], children: _jsx(AnalyticsDashboard, {}) }) }), _jsx(Route, { path: "/admin/approvals", element: _jsx(RequireRoles, { roles: ['admin'], children: _jsx(ApprovalInbox, {}) }) }), _jsx(Route, { path: "/simple/register", element: _jsx(SimpleRegister, {}) }), _jsx(Route, { path: "/pharmacy", element: _jsx(PharmacyMenu, {}) }), _jsx(Route, { path: "/pharmacy/reports", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(PharmacyReports, {}) }) }), _jsx(Route, { path: "/pharmacy/enhanced/:visitId", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(EnhancedPharmacy, { patientId: "", visitId: "", onSuccess: () => { } }) }) }), _jsx(Route, { path: "/triage/quick", element: _jsx(RequireRoles, { roles: ['nurse', 'doctor', 'admin'], children: _jsx(QuickTriage, { onComplete: () => { } }) }) })] }) }) }) }) })] }) }));
}
export default App;
