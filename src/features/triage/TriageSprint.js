import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/hooks/useT';
import { useAuthStore } from '@/stores/auth';
import { db } from '@/db';
import { GamificationService } from '@/services/gamification';
import { ExclamationTriangleIcon, ClockIcon, UserIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
export default function TriageSprint() {
    const { t } = useT();
    const { currentUser } = useAuthStore();
    const navigate = useNavigate();
    const [currentSession, setCurrentSession] = useState(null);
    const [currentCase, setCurrentCase] = useState(null);
    const [caseIndex, setCaseIndex] = useState(0);
    const [selectedPriority, setSelectedPriority] = useState(null);
    const [sessionStats, setSessionStats] = useState({
        correct: 0,
        total: 0,
        streak: 0,
        maxStreak: 0
    });
    const [timeLeft, setTimeLeft] = useState(120); // 2 minutes per case
    const [gameStarted, setGameStarted] = useState(false);
    const [showResult, setShowResult] = useState(false);
    // Sample triage cases
    const triageCases = [
        {
            id: '1',
            scenario: 'Adult male collapsed at home',
            patientAge: 45,
            patientSex: 'M',
            symptoms: ['chest pain', 'difficulty breathing', 'sweating'],
            vitals: {
                conscious: true,
                breathing: true,
                pulse: 'weak',
                skinColor: 'pale'
            },
            correctPriority: 'urgent',
            explanation: 'Chest pain with breathing difficulty and weak pulse suggests cardiac emergency'
        },
        {
            id: '2',
            scenario: 'Child with fever and cough',
            patientAge: 6,
            patientSex: 'F',
            symptoms: ['fever', 'cough', 'runny nose'],
            vitals: {
                conscious: true,
                breathing: true,
                pulse: 'normal',
                skinColor: 'normal'
            },
            correctPriority: 'normal',
            explanation: 'Common cold symptoms in stable child - routine care appropriate'
        },
        {
            id: '3',
            scenario: 'Elderly woman with minor cut',
            patientAge: 70,
            patientSex: 'F',
            symptoms: ['small laceration', 'no bleeding'],
            vitals: {
                conscious: true,
                breathing: true,
                pulse: 'normal',
                skinColor: 'normal'
            },
            correctPriority: 'low',
            explanation: 'Minor wound in stable patient can wait for routine care'
        },
        {
            id: '4',
            scenario: 'Unconscious patient brought by family',
            patientAge: 30,
            patientSex: 'M',
            symptoms: ['unconscious', 'unknown cause'],
            vitals: {
                conscious: false,
                breathing: true,
                pulse: 'weak',
                skinColor: 'pale'
            },
            correctPriority: 'urgent',
            explanation: 'Unconsciousness requires immediate assessment and intervention'
        },
        {
            id: '5',
            scenario: 'Pregnant woman with contractions',
            patientAge: 28,
            patientSex: 'F',
            symptoms: ['regular contractions', 'back pain'],
            vitals: {
                conscious: true,
                breathing: true,
                pulse: 'strong',
                skinColor: 'normal'
            },
            correctPriority: 'urgent',
            explanation: 'Active labor requires immediate obstetric care'
        }
    ];
    useEffect(() => {
        if (gameStarted && timeLeft > 0 && !showResult) {
            const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(timer);
        }
        else if (timeLeft === 0 && !showResult) {
            submitAnswer();
        }
    }, [gameStarted, timeLeft, showResult]);
    const startGame = async () => {
        if (!currentUser)
            return;
        try {
            // Shuffle cases and take 3
            const shuffled = [...triageCases].sort(() => Math.random() - 0.5).slice(0, 3);
            const session = await GamificationService.startSession('triage', currentUser.id, {
                totalCases: shuffled.length,
                startTime: new Date().toISOString()
            });
            setCurrentSession(session);
            setCurrentCase(shuffled[0]);
            setCaseIndex(0);
            setGameStarted(true);
            setTimeLeft(120);
            setSessionStats({ correct: 0, total: 0, streak: 0, maxStreak: 0 });
            setSelectedPriority(null);
            setShowResult(false);
        }
        catch (error) {
            console.error('Error starting triage sprint:', error);
        }
    };
    const submitAnswer = async () => {
        if (!currentCase || !currentSession)
            return;
        const isCorrect = selectedPriority === currentCase.correctPriority;
        const newStats = {
            ...sessionStats,
            total: sessionStats.total + 1,
            correct: sessionStats.correct + (isCorrect ? 1 : 0),
            streak: isCorrect ? sessionStats.streak + 1 : 0,
            maxStreak: Math.max(sessionStats.maxStreak, isCorrect ? sessionStats.streak + 1 : sessionStats.streak)
        };
        setSessionStats(newStats);
        // Show feedback
        setTimeout(() => {
            if (caseIndex < triageCases.length - 1) {
                setCaseIndex(caseIndex + 1);
                setCurrentCase(triageCases[caseIndex + 1]);
                setSelectedPriority(null);
                setTimeLeft(120);
            }
            else {
                endGame();
            }
        }, 2000);
    };
    const endGame = async () => {
        if (!currentSession || !currentUser)
            return;
        try {
            setShowResult(true);
            const accuracy = sessionStats.total > 0 ? sessionStats.correct / sessionStats.total : 0;
            const timeBonus = timeLeft > 30 ? 1.1 : 1.0;
            const streakBonus = sessionStats.maxStreak >= 3 ? 1.2 : 1.0;
            const wallet = await db.gamificationWallets.get(currentUser.id);
            const tokensEarned = GamificationService.calculateTokens(15, {
                accuracy,
                streak: wallet?.streakDays || 0,
                speedBonus: timeBonus,
                qualityBonus: streakBonus
            });
            await GamificationService.completeSession(currentSession.id, {
                score: Math.round(accuracy * 100),
                tokensEarned,
                badges: [],
                multipliers: { accuracy, speed: timeBonus, quality: streakBonus }
            });
            // Auto-navigate after showing results
            setTimeout(() => {
                navigate('/games');
            }, 5000);
        }
        catch (error) {
            console.error('Error ending game:', error);
        }
    };
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'urgent':
                return 'bg-red-500 hover:bg-red-600 text-white';
            case 'normal':
                return 'bg-yellow-500 hover:bg-yellow-600 text-white';
            case 'low':
                return 'bg-green-500 hover:bg-green-600 text-white';
        }
    };
    const getPriorityIcon = (priority) => {
        switch (priority) {
            case 'urgent':
                return '🚨';
            case 'normal':
                return '⚠️';
            case 'low':
                return '✅';
        }
    };
    if (!gameStarted) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Triage Sprint" }), _jsx("p", { className: "text-gray-600", children: "Quick priority assessment challenges" })] })] }), _jsx("div", { className: "card max-w-2xl mx-auto", children: _jsxs("div", { className: "text-center py-8", children: [_jsx(ExclamationTriangleIcon, { className: "h-16 w-16 mx-auto text-orange-500 mb-4" }), _jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Ready for Triage Training?" }), _jsx("div", { className: "bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6", children: _jsxs("div", { className: "text-sm text-orange-800", children: [_jsx("div", { className: "font-medium mb-2", children: "\uD83D\uDEA8 Challenge Rules:" }), _jsxs("ul", { className: "text-xs space-y-1 text-orange-700 text-left", children: [_jsx("li", { children: "\u2022 3 random patient scenarios" }), _jsx("li", { children: "\u2022 2 minutes per case to assess priority" }), _jsx("li", { children: "\u2022 +15 tokens per correct triage decision" }), _jsx("li", { children: "\u2022 +20% bonus for 3-case streak" }), _jsx("li", { children: "\u2022 +10% speed bonus if time remaining" }), _jsx("li", { children: "\u2022 Focus: ABC assessment and priority" })] })] }) }), _jsx("button", { onClick: startGame, className: "btn-primary", children: "Start Triage Sprint" })] }) })] }));
    }
    if (showResult) {
        const accuracy = Math.round((sessionStats.correct / sessionStats.total) * 100);
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Triage Sprint Complete!" }), _jsx("p", { className: "text-gray-600", children: "Excellent work on patient prioritization!" })] })] }), _jsx("div", { className: "card max-w-2xl mx-auto", children: _jsxs("div", { className: "text-center py-8", children: [_jsx("div", { className: "text-6xl mb-4", children: accuracy >= 80 ? '🏆' : accuracy >= 60 ? '🥈' : '🥉' }), _jsxs("div", { className: "grid grid-cols-3 gap-6 mb-6", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-3xl font-bold text-primary", children: [sessionStats.correct, "/", sessionStats.total] }), _jsx("div", { className: "text-sm text-gray-600", children: "Correct" })] }), _jsxs("div", { children: [_jsxs("div", { className: "text-3xl font-bold text-orange-600", children: [accuracy, "%"] }), _jsx("div", { className: "text-sm text-gray-600", children: "Accuracy" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-3xl font-bold text-red-600", children: sessionStats.maxStreak }), _jsx("div", { className: "text-sm text-gray-600", children: "Max Streak" })] })] }), _jsx("div", { className: "bg-green-50 border border-green-200 rounded-lg p-4 mb-6", children: _jsx("p", { className: "text-green-800 font-medium", children: "\uD83C\uDF89 Session completed! Waiting for supervisor approval to mint tokens." }) }), _jsx("button", { onClick: () => navigate('/games'), className: "btn-primary", children: "Back to Game Hub" })] }) })] }));
    }
    if (!currentCase)
        return null;
    const isAnswered = selectedPriority !== null;
    const isCorrect = selectedPriority === currentCase.correctPriority;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Triage Sprint" }), _jsxs("p", { className: "text-gray-600", children: ["Case ", caseIndex + 1, " of ", triageCases.length] })] })] }), _jsxs("div", { className: "flex items-center space-x-6", children: [_jsxs("div", { className: "text-center", children: [_jsxs("div", { className: "text-2xl font-bold text-primary", children: [sessionStats.correct, "/", sessionStats.total] }), _jsx("div", { className: "text-sm text-gray-600", children: "Correct" })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-orange-600", children: sessionStats.streak }), _jsx("div", { className: "text-sm text-gray-600", children: "Streak" })] }), _jsxs("div", { className: "text-center flex items-center space-x-1", children: [_jsx(ClockIcon, { className: "h-5 w-5 text-red-500" }), _jsx("div", { className: `text-2xl font-bold ${timeLeft <= 30 ? 'text-red-600 animate-pulse' : 'text-red-600'}`, children: formatTime(timeLeft) })] })] })] }), _jsx("div", { className: "card max-w-4xl mx-auto", children: _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-8", children: [_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Patient Presentation" }), _jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-3", children: [_jsx(UserIcon, { className: "h-6 w-6 text-blue-600" }), _jsx("div", { children: _jsxs("p", { className: "font-medium text-blue-800", children: [currentCase.patientAge, " year old ", currentCase.patientSex === 'M' ? 'male' : 'female'] }) })] }), _jsx("p", { className: "text-blue-700 text-lg", children: currentCase.scenario })] })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-3", children: "Symptoms" }), _jsx("div", { className: "flex flex-wrap gap-2", children: currentCase.symptoms.map((symptom, index) => (_jsx("span", { className: "px-3 py-2 bg-gray-100 text-gray-800 rounded-full text-sm font-medium", children: symptom }, index))) })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-3", children: "Quick Assessment" }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "flex items-center justify-between p-3 bg-gray-50 rounded-lg", children: [_jsx("span", { className: "text-sm font-medium", children: "Conscious:" }), _jsx("span", { className: `text-sm font-bold ${currentCase.vitals.conscious ? 'text-green-600' : 'text-red-600'}`, children: currentCase.vitals.conscious ? 'Yes' : 'No' })] }), _jsxs("div", { className: "flex items-center justify-between p-3 bg-gray-50 rounded-lg", children: [_jsx("span", { className: "text-sm font-medium", children: "Breathing:" }), _jsx("span", { className: `text-sm font-bold ${currentCase.vitals.breathing ? 'text-green-600' : 'text-red-600'}`, children: currentCase.vitals.breathing ? 'Yes' : 'No' })] }), _jsxs("div", { className: "flex items-center justify-between p-3 bg-gray-50 rounded-lg", children: [_jsx("span", { className: "text-sm font-medium", children: "Pulse:" }), _jsx("span", { className: "text-sm font-bold capitalize", children: currentCase.vitals.pulse })] }), _jsxs("div", { className: "flex items-center justify-between p-3 bg-gray-50 rounded-lg", children: [_jsx("span", { className: "text-sm font-medium", children: "Skin Color:" }), _jsx("span", { className: "text-sm font-bold capitalize", children: currentCase.vitals.skinColor })] })] })] })] }), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Assign Priority" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Based on the patient presentation, what priority should this case receive?" })] }), _jsx("div", { className: "space-y-4", children: ['urgent', 'normal', 'low'].map((priority) => (_jsx("button", { onClick: () => setSelectedPriority(priority), disabled: isAnswered, className: `w-full p-6 rounded-xl border-2 transition-all touch-target-large ${selectedPriority === priority
                                            ? `${getPriorityColor(priority)} ring-2 ring-primary/20`
                                            : 'bg-white border-gray-200 hover:border-gray-300'} ${isAnswered ? 'cursor-not-allowed' : ''}`, children: _jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("div", { className: "text-4xl", children: getPriorityIcon(priority) }), _jsxs("div", { className: "text-left", children: [_jsx("div", { className: "text-xl font-bold capitalize", children: priority }), _jsxs("div", { className: "text-sm opacity-90", children: [priority === 'urgent' && 'Immediate attention required', priority === 'normal' && 'Standard care pathway', priority === 'low' && 'Can wait for routine care'] })] })] }) }, priority))) }), _jsx("div", { className: "text-center pt-4", children: _jsx("button", { onClick: submitAnswer, disabled: !selectedPriority || isAnswered, className: "btn-primary disabled:opacity-50 disabled:cursor-not-allowed", children: "Submit Priority Decision" }) }), isAnswered && (_jsxs("div", { className: `p-4 rounded-lg border ${isCorrect
                                        ? 'bg-green-50 border-green-200'
                                        : 'bg-red-50 border-red-200'}`, children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [isCorrect ? (_jsx(CheckCircleIcon, { className: "h-5 w-5 text-green-600" })) : (_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600" })), _jsx("span", { className: `font-medium ${isCorrect ? 'text-green-800' : 'text-red-800'}`, children: isCorrect ? 'Correct!' : 'Incorrect' })] }), _jsxs("p", { className: `text-sm ${isCorrect ? 'text-green-700' : 'text-red-700'}`, children: [_jsx("strong", { children: "Correct Priority:" }), " ", currentCase.correctPriority] }), _jsx("p", { className: `text-sm mt-2 ${isCorrect ? 'text-green-700' : 'text-red-700'}`, children: currentCase.explanation })] }))] })] }) })] }));
}
