import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { db } from '@/db';
import { TrophyIcon, FireIcon, StarIcon, ClockIcon, HeartIcon, CubeIcon, AcademicCapIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
export function GameHub({ className = '' }) {
    const { currentUser } = useAuthStore();
    const [wallet, setWallet] = useState(null);
    const [pendingSessions, setPendingSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (currentUser) {
            loadGameData();
        }
    }, [currentUser]);
    const loadGameData = async () => {
        if (!currentUser)
            return;
        try {
            const [walletData, sessionsData] = await Promise.all([
                db.gamificationWallets.get(currentUser.id),
                db.gameSessions
                    .where('volunteerId')
                    .equals(currentUser.id)
                    .and(session => !session.committed && session.finishedAt)
                    .toArray()
            ]);
            setWallet(walletData);
            setPendingSessions(sessionsData);
        }
        catch (error) {
            console.error('Error loading game data:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const games = [
        {
            id: 'vitals',
            name: 'Vitals Precision',
            description: 'Validate vital signs with accuracy bonuses',
            icon: HeartIcon,
            color: 'bg-green-500 hover:bg-green-600',
            baseTokens: 8,
            estimatedMinutes: 3,
            href: '/games/vitals-precision'
        },
        {
            id: 'shelf',
            name: 'Shelf Sleuth',
            description: 'Verify inventory counts and find discrepancies',
            icon: CubeIcon,
            color: 'bg-blue-500 hover:bg-blue-600',
            baseTokens: 12,
            estimatedMinutes: 5,
            href: '/games/shelf-sleuth'
        },
        {
            id: 'quiz',
            name: 'Knowledge Blitz',
            description: '60-second protocol and procedure quizzes',
            icon: AcademicCapIcon,
            color: 'bg-purple-500 hover:bg-purple-600',
            baseTokens: 10,
            estimatedMinutes: 1,
            href: '/games/knowledge-blitz'
        },
        {
            id: 'triage',
            name: 'Triage Sprint',
            description: 'Quick priority assessment challenges',
            icon: ExclamationTriangleIcon,
            color: 'bg-orange-500 hover:bg-orange-600',
            baseTokens: 15,
            estimatedMinutes: 2,
            href: '/games/triage-sprint'
        },
        {
            id: 'vitals-enhanced',
            name: 'Enhanced Vitals',
            description: 'Age/sex-specific vital signs validation',
            icon: HeartIcon,
            color: 'bg-emerald-500 hover:bg-emerald-600',
            baseTokens: 12,
            estimatedMinutes: 4,
            href: '/games/vitals-precision-enhanced'
        }
    ];
    if (loading) {
        return (_jsx("div", { className: `space-y-6 ${className}`, children: _jsxs("div", { className: "animate-pulse", children: [_jsx("div", { className: "h-8 bg-gray-200 rounded w-48 mb-4" }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4", children: [...Array(4)].map((_, i) => (_jsx("div", { className: "h-32 bg-gray-200 rounded-lg" }, i))) })] }) }));
    }
    return (_jsxs("div", { className: `space-y-6 ${className}`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(TrophyIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Game Hub" }), _jsx("p", { className: "text-gray-600", children: "Earn tokens and badges through clinic work" })] })] }), wallet && (_jsxs("div", { className: "flex items-center space-x-6", children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-primary", children: wallet.tokens }), _jsx("div", { className: "text-sm text-gray-600", children: "Tokens" })] }), _jsxs("div", { className: "text-center", children: [_jsxs("div", { className: "text-2xl font-bold text-orange-600", children: ["Level ", wallet.level] }), _jsx("div", { className: "text-sm text-gray-600", children: "Current Level" })] }), _jsxs("div", { className: "text-center flex items-center space-x-1", children: [_jsx(FireIcon, { className: "h-5 w-5 text-red-500" }), _jsx("div", { className: "text-xl font-bold text-red-600", children: wallet.streakDays }), _jsx("div", { className: "text-sm text-gray-600", children: "Day Streak" })] })] }))] }), pendingSessions.length > 0 && (_jsx("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ClockIcon, { className: "h-5 w-5 text-yellow-600" }), _jsxs("div", { children: [_jsxs("h3", { className: "text-sm font-medium text-yellow-800", children: ["Pending Approval (", pendingSessions.length, " sessions)"] }), _jsx("p", { className: "text-sm text-yellow-700", children: "Your completed game sessions are waiting for supervisor approval to mint tokens." })] })] }) })), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", children: games.map((game) => (_jsx(Link, { to: game.href, className: `${game.color} text-white rounded-lg p-6 transition-all hover:scale-105 transform group`, children: _jsxs("div", { className: "text-center", children: [_jsx(game.icon, { className: "h-12 w-12 mx-auto mb-4 group-hover:scale-110 transition-transform" }), _jsx("h3", { className: "text-lg font-bold mb-2", children: game.name }), _jsx("p", { className: "text-sm opacity-90 mb-4", children: game.description }), _jsxs("div", { className: "flex items-center justify-between text-sm", children: [_jsxs("div", { className: "flex items-center space-x-1", children: [_jsx(ClockIcon, { className: "h-4 w-4" }), _jsxs("span", { children: [game.estimatedMinutes, " min"] })] }), _jsxs("div", { className: "flex items-center space-x-1", children: [_jsx(StarIcon, { className: "h-4 w-4" }), _jsxs("span", { children: [game.baseTokens, " tokens"] })] })] })] }) }, game.id))) }), wallet?.badges.length > 0 && (_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Recent Badges" }), _jsx("div", { className: "flex flex-wrap gap-2", children: wallet.badges.slice(-6).map((badge, index) => (_jsxs("span", { className: "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800", children: ["\uD83C\uDFC6 ", badge.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())] }, index))) })] })), !wallet && (_jsx("div", { className: "card bg-blue-50 border-blue-200", children: _jsxs("div", { className: "text-center py-8", children: [_jsx(TrophyIcon, { className: "h-12 w-12 mx-auto text-blue-600 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-blue-800 mb-2", children: "Welcome to the Game Hub!" }), _jsx("p", { className: "text-blue-700 mb-4", children: "Complete your first game to start earning tokens and badges." }), _jsx("p", { className: "text-sm text-blue-600", children: "All games are based on real clinic work - you're helping patients while having fun!" })] }) }))] }));
}
