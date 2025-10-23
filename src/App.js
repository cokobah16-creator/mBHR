import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Layout } from '@/components/Layout';
import RequireRoles from '@/components/RequireRoles';
import Login from '@/pages/Login';
import { useAuthStore } from '@/stores/auth';
import { seedDemo } from '@/db/seedMbhr';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
// Core pages - loaded eagerly for initial navigation
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Register = lazy(() => import('@/pages/Register').then(m => ({ default: m.Register })));
const Patients = lazy(() => import('@/pages/Patients').then(m => ({ default: m.Patients })));
const SimpleRegister = lazy(() => import('@/pages/SimpleRegister').then(m => ({ default: m.SimpleRegister })));
// Patient detail and workflow pages
const PatientDetail = lazy(() => import('@/pages/PatientDetail').then(m => ({ default: m.PatientDetail })));
const Queue = lazy(() => import('@/pages/Queue').then(m => ({ default: m.Queue })));
const Vitals = lazy(() => import('@/pages/Vitals').then(m => ({ default: m.Vitals })));
const Consult = lazy(() => import('@/pages/Consult').then(m => ({ default: m.Consult })));
// Pharmacy pages
const Pharmacy = lazy(() => import('@/pages/Pharmacy').then(m => ({ default: m.Pharmacy })));
const PharmacyMenu = lazy(() => import('@/pages/PharmacyMenu'));
const PharmacyReports = lazy(() => import('@/pages/PharmacyReports'));
const PharmacyStock = lazy(() => import('@/features/pharmacy/PharmacyStock'));
const RxForm = lazy(() => import('@/features/pharmacy/RxForm'));
const Dispense = lazy(() => import('@/features/pharmacy/Dispense'));
const EnhancedPharmacy = lazy(() => import('@/features/pharmacy/EnhancedPharmacy'));
const FEFODispenser = lazy(() => import('@/features/pharmacy/FEFODispenser'));
// Inventory and gamification
const Inventory = lazy(() => import('@/pages/Inventory').then(m => ({ default: m.Inventory })));
const RestockGame = lazy(() => import('@/features/inventory/RestockGame'));
const PrizeShop = lazy(() => import('@/features/inventory/PrizeShop'));
// Queue/ticket management
const QueueBoard = lazy(() => import('@/features/tickets/QueueBoard'));
const TicketIssuer = lazy(() => import('@/features/tickets/TicketIssuer'));
const PublicDisplay = lazy(() => import('@/features/tickets/PublicDisplay'));
// Gamification features
const GameHub = lazy(() => import('@/components/GameHub').then(m => ({ default: m.GameHub })));
const QuestBoard = lazy(() => import('@/components/QuestBoard').then(m => ({ default: m.QuestBoard })));
const Leaderboard = lazy(() => import('@/features/gamification/Leaderboard'));
const QueueMaestro = lazy(() => import('@/features/gamification/QueueMaestro'));
const KnowledgeBlitz = lazy(() => import('@/features/gamification/KnowledgeBlitz'));
const VitalsPrecisionGame = lazy(() => import('@/features/vitals/VitalsPrecisionGame'));
const ApprovalInbox = lazy(() => import('@/features/gamification/ApprovalInbox'));
// Triage features
const TriageSprint = lazy(() => import('@/features/triage/TriageSprint'));
const QuickTriage = lazy(() => import('@/features/triage/QuickTriage'));
// Analytics (admin only)
const AnalyticsDashboard = lazy(() => import('@/features/analytics/AnalyticsDashboard'));
// Admin
const Users = lazy(() => import('@/pages/Users').then(m => ({ default: m.Users })));
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
    return (_jsxs(ErrorBoundary, { children: [_jsx(PWAInstallPrompt, {}), _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Login, {}) }), _jsx(Route, { path: "/*", element: _jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx("div", { className: "min-h-screen flex items-center justify-center", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading..." })] }) }), children: _jsx(Layout, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/register", element: _jsx(Register, {}) }), _jsx(Route, { path: "/patients", element: _jsx(Patients, {}) }), _jsx(Route, { path: "/patients/:id", element: _jsx(PatientDetail, {}) }), _jsx(Route, { path: "/queue", element: _jsx(Queue, {}) }), _jsx(Route, { path: "/inventory", element: _jsx(Inventory, {}) }), _jsx(Route, { path: "/users", element: _jsx(Users, {}) }), _jsx(Route, { path: "/vitals", element: _jsx(Vitals, {}) }), _jsx(Route, { path: "/vitals/:visitId", element: _jsx(Vitals, {}) }), _jsx(Route, { path: "/consult", element: _jsx(Consult, {}) }), _jsx(Route, { path: "/consult/:visitId", element: _jsx(Consult, {}) }), _jsx(Route, { path: "/pharmacy", element: _jsx(Pharmacy, {}) }), _jsx(Route, { path: "/pharmacy/:visitId", element: _jsx(Pharmacy, {}) }), _jsx(Route, { path: "/inv/game", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(RestockGame, {}) }) }), _jsx(Route, { path: "/inv/prizes", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(PrizeShop, {}) }) }), _jsx(Route, { path: "/rx/stock", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(PharmacyStock, {}) }) }), _jsx(Route, { path: "/rx/new", element: _jsx(RequireRoles, { roles: ['doctor', 'nurse', 'admin'], children: _jsx(RxForm, {}) }) }), _jsx(Route, { path: "/rx/dispense", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(Dispense, {}) }) }), _jsx(Route, { path: "/tickets/queue", element: _jsx(RequireRoles, { roles: ['nurse', 'doctor', 'admin'], children: _jsx(QueueBoard, {}) }) }), _jsx(Route, { path: "/tickets/issue", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'doctor', 'admin'], children: _jsx(TicketIssuer, {}) }) }), _jsx(Route, { path: "/inv/leaderboard", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(Leaderboard, {}) }) }), _jsx(Route, { path: "/display", element: _jsx(PublicDisplay, {}) }), _jsx(Route, { path: "/quests", element: _jsx(QuestBoard, {}) }), _jsx(Route, { path: "/games/queue-maestro", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(QueueMaestro, {}) }) }), _jsx(Route, { path: "/games", element: _jsx(GameHub, {}) }), _jsx(Route, { path: "/games/vitals-precision", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(VitalsPrecisionGame, {}) }) }), _jsx(Route, { path: "/games/knowledge-blitz", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(KnowledgeBlitz, {}) }) }), _jsx(Route, { path: "/games/triage-sprint", element: _jsx(RequireRoles, { roles: ['nurse', 'doctor', 'admin'], children: _jsx(TriageSprint, {}) }) }), _jsx(Route, { path: "/games/vitals-precision-enhanced", element: _jsx(RequireRoles, { roles: ['volunteer', 'nurse', 'admin'], children: _jsx(VitalsPrecisionGame, {}) }) }), _jsx(Route, { path: "/analytics", element: _jsx(RequireRoles, { roles: ['admin'], children: _jsx(AnalyticsDashboard, {}) }) }), _jsx(Route, { path: "/admin/approvals", element: _jsx(RequireRoles, { roles: ['admin'], children: _jsx(ApprovalInbox, {}) }) }), _jsx(Route, { path: "/simple/register", element: _jsx(SimpleRegister, {}) }), _jsx(Route, { path: "/pharmacy", element: _jsx(PharmacyMenu, {}) }), _jsx(Route, { path: "/pharmacy/reports", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(PharmacyReports, {}) }) }), _jsx(Route, { path: "/pharmacy/enhanced/:visitId", element: _jsx(RequireRoles, { roles: ['pharmacist', 'admin'], children: _jsx(EnhancedPharmacy, { patientId: "", visitId: "", onSuccess: () => { } }) }) }), _jsx(Route, { path: "/triage/quick", element: _jsx(RequireRoles, { roles: ['nurse', 'doctor', 'admin'], children: _jsx(QuickTriage, { onComplete: () => { } }) }) })] }) }) }) }) })] })] }));
}
export default App;
