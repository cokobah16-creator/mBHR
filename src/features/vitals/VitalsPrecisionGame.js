import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/hooks/useT';
import { useAuthStore } from '@/stores/auth';
import { db } from '@/db';
import { GamificationService } from '@/services/gamification';
import { HeartIcon, CheckCircleIcon, XCircleIcon, ClockIcon } from '@heroicons/react/24/outline';
export default function VitalsPrecisionGame() {
    const { t } = useT();
    const { currentUser } = useAuthStore();
    const navigate = useNavigate();
    const [currentSession, setCurrentSession] = useState(null);
    const [currentCase, setCurrentCase] = useState(null);
    const [caseIndex, setCaseIndex] = useState(0);
    const [userAnswers, setUserAnswers] = useState({});
    const [sessionStats, setSessionStats] = useState({
        correct: 0,
        total: 0,
        streak: 0,
        maxStreak: 0
    });
    const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
    const [gameStarted, setGameStarted] = useState(false);
    const [showResult, setShowResult] = useState(false);
    // Enhanced vital cases with age/sex-specific ranges
    const vitalCases = [
        {
            id: '1',
            patientAge: 35,
            patientSex: 'M',
            scenario: 'Adult male presenting with chest pain',
            vitals: { hr: 110, temp: 37.2, sbp: 150, dbp: 95, rr: 22, spo2: 97 },
            normalRanges: {
                hr: [60, 100],
                temp: [36.1, 37.2],
                sbp: [90, 140],
                dbp: [60, 90],
                rr: [12, 20],
                spo2: [95, 100]
            }
        },
        {
            id: '2',
            patientAge: 8,
            patientSex: 'F',
            scenario: 'Child with fever and cough',
            vitals: { hr: 130, temp: 39.1, sbp: 95, dbp: 60, rr: 28, spo2: 95 },
            normalRanges: {
                hr: [80, 120],
                temp: [36.1, 37.2],
                sbp: [85, 110],
                dbp: [50, 70],
                rr: [20, 30],
                spo2: [95, 100]
            }
        },
        {
            id: '3',
            patientAge: 65,
            patientSex: 'F',
            scenario: 'Elderly woman routine check',
            vitals: { hr: 72, temp: 36.8, sbp: 135, dbp: 85, rr: 16, spo2: 98 },
            normalRanges: {
                hr: [60, 100],
                temp: [36.1, 37.2],
                sbp: [90, 140],
                dbp: [60, 90],
                rr: [12, 20],
                spo2: [95, 100]
            }
        },
        {
            id: '4',
            patientAge: 25,
            patientSex: 'M',
            scenario: 'Young athlete post-exercise',
            vitals: { hr: 95, temp: 37.0, sbp: 120, dbp: 75, rr: 18, spo2: 99 },
            normalRanges: {
                hr: [60, 100],
                temp: [36.1, 37.2],
                sbp: [90, 140],
                dbp: [60, 90],
                rr: [12, 20],
                spo2: [95, 100]
            }
        },
        {
            id: '5',
            patientAge: 45,
            patientSex: 'F',
            scenario: 'Woman with headache',
            vitals: { hr: 88, temp: 36.5, sbp: 165, dbp: 100, rr: 20, spo2: 98 },
            normalRanges: {
                hr: [60, 100],
                temp: [36.1, 37.2],
                sbp: [90, 140],
                dbp: [60, 90],
                rr: [12, 20],
                spo2: [95, 100]
            }
        }
    ];
    useEffect(() => {
        if (gameStarted && timeLeft > 0 && !showResult) {
            const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(timer);
        }
        else if (timeLeft === 0 && !showResult) {
            endGame();
        }
    }, [gameStarted, timeLeft, showResult]);
    const startGame = async () => {
        if (!currentUser)
            return;
        try {
            // Shuffle cases and take 5
            const shuffled = [...vitalCases].sort(() => Math.random() - 0.5);
            const session = await GamificationService.startSession('vitals', currentUser.id, {
                totalCases: shuffled.length,
                startTime: new Date().toISOString()
            });
            setCurrentSession(session);
            setCurrentCase(shuffled[0]);
            setCaseIndex(0);
            setGameStarted(true);
            setTimeLeft(300);
            setSessionStats({ correct: 0, total: 0, streak: 0, maxStreak: 0 });
            setUserAnswers({});
            setShowResult(false);
        }
        catch (error) {
            console.error('Error starting vitals precision game:', error);
        }
    };
    const submitAnswer = async (metric, answer) => {
        if (!currentCase || !currentSession)
            return;
        const isCorrect = checkAnswer(currentCase, metric, answer);
        const newAnswers = { ...userAnswers, [`${currentCase.id}_${metric}`]: answer };
        setUserAnswers(newAnswers);
        // Update stats
        const newStats = {
            ...sessionStats,
            total: sessionStats.total + 1,
            correct: sessionStats.correct + (isCorrect ? 1 : 0),
            streak: isCorrect ? sessionStats.streak + 1 : 0,
            maxStreak: Math.max(sessionStats.maxStreak, isCorrect ? sessionStats.streak + 1 : sessionStats.streak)
        };
        setSessionStats(newStats);
        // Check if case is complete
        const caseMetrics = Object.keys(currentCase.vitals);
        const caseAnswers = caseMetrics.filter(metric => newAnswers[`${currentCase.id}_${metric}`]);
        if (caseAnswers.length === caseMetrics.length) {
            // Move to next case
            setTimeout(() => {
                if (caseIndex < vitalCases.length - 1) {
                    setCaseIndex(caseIndex + 1);
                    setCurrentCase(vitalCases[caseIndex + 1]);
                }
                else {
                    endGame();
                }
            }, 1500);
        }
    };
    const checkAnswer = (vitalCase, metric, answer) => {
        const value = vitalCase.vitals[metric];
        if (!value)
            return false;
        const range = vitalCase.normalRanges[metric];
        if (!range)
            return false;
        const isNormal = value >= range[0] && value <= range[1];
        return (answer === 'normal') === isNormal;
    };
    const endGame = async () => {
        if (!currentSession || !currentUser)
            return;
        try {
            setShowResult(true);
            const accuracy = sessionStats.total > 0 ? sessionStats.correct / sessionStats.total : 0;
            const timeBonus = timeLeft > 60 ? 1.1 : 1.0;
            const streakBonus = sessionStats.maxStreak >= 8 ? 1.2 : 1.0;
            const wallet = await db.gamificationWallets.get(currentUser.id);
            const tokensEarned = GamificationService.calculateTokens(12, {
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
    if (!gameStarted) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(HeartIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Vitals Precision" }), _jsx("p", { className: "text-gray-600", children: "Enhanced vital signs validation training" })] })] }), _jsx("div", { className: "card max-w-2xl mx-auto", children: _jsxs("div", { className: "text-center py-8", children: [_jsx(HeartIcon, { className: "h-16 w-16 mx-auto text-green-500 mb-4" }), _jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Ready for Enhanced Training?" }), _jsxs("div", { className: "space-y-4 text-left max-w-md mx-auto mb-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-blue-600 font-semibold text-sm", children: "1" }) }), _jsxs("p", { className: "text-gray-700", children: ["Review ", vitalCases.length, " patient scenarios with age/sex context"] })] }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-blue-600 font-semibold text-sm", children: "2" }) }), _jsx("p", { className: "text-gray-700", children: "Identify normal vs abnormal vital signs using clinical ranges" })] }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-blue-600 font-semibold text-sm", children: "3" }) }), _jsx("p", { className: "text-gray-700", children: "Earn tokens based on accuracy, speed, and streak performance" })] })] }), _jsx("div", { className: "bg-green-50 border border-green-200 rounded-lg p-4 mb-6", children: _jsxs("div", { className: "text-sm text-green-800", children: [_jsx("div", { className: "font-medium mb-1", children: "\uD83D\uDCA1 Enhanced Scoring:" }), _jsxs("ul", { className: "text-xs space-y-1 text-green-700", children: [_jsx("li", { children: "\u2022 Base: 12 tokens" }), _jsx("li", { children: "\u2022 Accuracy bonus: up to +30%" }), _jsx("li", { children: "\u2022 Speed bonus: +10% if 1+ minute remaining" }), _jsx("li", { children: "\u2022 Streak bonus: +20% for 8+ correct in a row" }), _jsx("li", { children: "\u2022 Age/sex-specific normal ranges" })] })] }) }), _jsx("button", { onClick: startGame, className: "btn-primary", children: "Start Enhanced Vitals Precision" })] }) })] }));
    }
    if (showResult) {
        const accuracy = Math.round((sessionStats.correct / sessionStats.total) * 100);
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(HeartIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Vitals Precision Complete!" }), _jsx("p", { className: "text-gray-600", children: "Excellent work on clinical assessment!" })] })] }), _jsx("div", { className: "card max-w-2xl mx-auto", children: _jsxs("div", { className: "text-center py-8", children: [_jsx("div", { className: "text-6xl mb-4", children: accuracy >= 90 ? '🏆' : accuracy >= 75 ? '🥈' : '🥉' }), _jsxs("div", { className: "grid grid-cols-3 gap-6 mb-6", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-3xl font-bold text-primary", children: [sessionStats.correct, "/", sessionStats.total] }), _jsx("div", { className: "text-sm text-gray-600", children: "Correct" })] }), _jsxs("div", { children: [_jsxs("div", { className: "text-3xl font-bold text-orange-600", children: [accuracy, "%"] }), _jsx("div", { className: "text-sm text-gray-600", children: "Accuracy" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-3xl font-bold text-red-600", children: sessionStats.maxStreak }), _jsx("div", { className: "text-sm text-gray-600", children: "Max Streak" })] })] }), _jsx("div", { className: "bg-green-50 border border-green-200 rounded-lg p-4 mb-6", children: _jsx("p", { className: "text-green-800 font-medium", children: "\uD83C\uDF89 Enhanced session completed! Waiting for supervisor approval to mint tokens." }) }), _jsx("button", { onClick: () => navigate('/games'), className: "btn-primary", children: "Back to Game Hub" })] }) })] }));
    }
    if (!currentCase)
        return null;
    const caseMetrics = Object.keys(currentCase.vitals);
    const answeredMetrics = caseMetrics.filter(metric => userAnswers[`${currentCase.id}_${metric}`]);
    const progress = (answeredMetrics.length / caseMetrics.length) * 100;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(HeartIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Vitals Precision" }), _jsxs("p", { className: "text-gray-600", children: ["Case ", caseIndex + 1, " of ", vitalCases.length] })] })] }), _jsxs("div", { className: "flex items-center space-x-6", children: [_jsxs("div", { className: "text-center", children: [_jsxs("div", { className: "text-2xl font-bold text-primary", children: [sessionStats.correct, "/", sessionStats.total] }), _jsx("div", { className: "text-sm text-gray-600", children: "Correct" })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-orange-600", children: sessionStats.streak }), _jsx("div", { className: "text-sm text-gray-600", children: "Streak" })] }), _jsxs("div", { className: "text-center flex items-center space-x-1", children: [_jsx(ClockIcon, { className: "h-5 w-5 text-red-500" }), _jsx("div", { className: `text-2xl font-bold ${timeLeft <= 60 ? 'text-red-600 animate-pulse' : 'text-red-600'}`, children: formatTime(timeLeft) })] })] })] }), _jsx("div", { className: "w-full bg-gray-200 rounded-full h-3", children: _jsx("div", { className: "bg-primary h-3 rounded-full transition-all duration-300", style: { width: `${progress}%` } }) }), _jsxs("div", { className: "card max-w-5xl mx-auto", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900 mb-2", children: "Patient Scenario" }), _jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsxs("p", { className: "text-blue-800", children: [_jsx("strong", { children: "Age:" }), " ", currentCase.patientAge, " years old \u2022", _jsx("strong", { children: "Sex:" }), " ", currentCase.patientSex === 'M' ? 'Male' : 'Female'] }), _jsx("p", { className: "text-blue-700 mt-2", children: currentCase.scenario })] })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", children: Object.entries(currentCase.vitals).map(([metric, value]) => {
                            const answered = userAnswers[`${currentCase.id}_${metric}`];
                            const range = currentCase.normalRanges[metric];
                            const isNormal = value >= range[0] && value <= range[1];
                            const isCorrect = answered && ((answered === 'normal') === isNormal);
                            const metricLabels = {
                                hr: 'Heart Rate',
                                temp: 'Temperature',
                                sbp: 'Systolic BP',
                                dbp: 'Diastolic BP',
                                rr: 'Respiratory Rate',
                                spo2: 'SpO2'
                            };
                            const metricUnits = {
                                hr: 'bpm',
                                temp: '°C',
                                sbp: 'mmHg',
                                dbp: 'mmHg',
                                rr: '/min',
                                spo2: '%'
                            };
                            return (_jsxs("div", { className: `border rounded-lg p-4 transition-all ${answered
                                    ? isCorrect
                                        ? 'border-green-200 bg-green-50'
                                        : 'border-red-200 bg-red-50'
                                    : 'border-gray-200 hover:border-gray-300'}`, children: [_jsxs("div", { className: "text-center mb-4", children: [_jsx("h3", { className: "font-medium text-gray-900", children: metricLabels[metric] }), _jsxs("div", { className: "text-4xl font-bold text-primary mt-2", children: [value, _jsx("span", { className: "text-lg text-gray-600 ml-1", children: metricUnits[metric] })] }), _jsxs("div", { className: "text-xs text-gray-500 mt-1", children: ["Normal: ", range[0], "-", range[1], " ", metricUnits[metric]] })] }), answered ? (_jsxs("div", { className: "flex items-center justify-center space-x-2", children: [isCorrect ? (_jsx(CheckCircleIcon, { className: "h-5 w-5 text-green-600" })) : (_jsx(XCircleIcon, { className: "h-5 w-5 text-red-600" })), _jsxs("span", { className: `text-sm font-medium capitalize ${isCorrect ? 'text-green-700' : 'text-red-700'}`, children: [answered, " ", isCorrect ? '✓' : '✗'] })] })) : (_jsxs("div", { className: "flex space-x-2", children: [_jsx("button", { onClick: () => submitAnswer(metric, 'normal'), className: "flex-1 bg-green-100 text-green-800 py-3 px-4 rounded-lg hover:bg-green-200 transition-colors font-medium touch-target-large", children: "Normal" }), _jsx("button", { onClick: () => submitAnswer(metric, 'abnormal'), className: "flex-1 bg-red-100 text-red-800 py-3 px-4 rounded-lg hover:bg-red-200 transition-colors font-medium touch-target-large", children: "Abnormal" })] }))] }, metric));
                        }) }), _jsxs("div", { className: "mt-6 text-center", children: [_jsxs("p", { className: "text-sm text-gray-600", children: [answeredMetrics.length, " of ", caseMetrics.length, " vitals assessed"] }), answeredMetrics.length === caseMetrics.length && caseIndex < vitalCases.length - 1 && (_jsx("p", { className: "text-sm text-green-600 mt-2", children: "\u2705 Case complete! Moving to next case..." }))] })] }), _jsx("div", { className: "text-center", children: _jsx("button", { onClick: () => navigate('/games'), className: "btn-secondary", children: "Cancel Game" }) })] }));
}
