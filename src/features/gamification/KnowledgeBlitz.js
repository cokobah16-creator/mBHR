import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { db } from '@/db';
import { GamificationService } from '@/services/gamification';
import { AcademicCapIcon, ClockIcon } from '@heroicons/react/24/outline';
export default function KnowledgeBlitz() {
    const { currentUser } = useAuthStore();
    const navigate = useNavigate();
    const [currentSession, setCurrentSession] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [answers, setAnswers] = useState([]);
    const [timeLeft, setTimeLeft] = useState(60); // 60 seconds
    const [gameStarted, setGameStarted] = useState(false);
    const [showResult, setShowResult] = useState(false);
    const [streak, setStreak] = useState(0);
    const [maxStreak, setMaxStreak] = useState(0);
    // Sample questions (in production, these would come from database)
    const questionBank = [
        {
            id: '1',
            topic: 'vital_signs',
            difficulty: 'easy',
            stem: 'What is the normal resting heart rate range for adults?',
            choices: ['40-60 bpm', '60-100 bpm', '100-120 bpm', '120-140 bpm'],
            answerIndex: 1,
            explanation: 'Normal adult resting heart rate is 60-100 beats per minute.'
        },
        {
            id: '2',
            topic: 'medication',
            difficulty: 'medium',
            stem: 'Which medication should be stored in a cool, dry place?',
            choices: ['Paracetamol tablets', 'Insulin vials', 'Cough syrup', 'All of the above'],
            answerIndex: 3,
            explanation: 'All medications should be stored properly to maintain efficacy.'
        },
        {
            id: '3',
            topic: 'infection_control',
            difficulty: 'easy',
            stem: 'How long should you wash your hands with soap?',
            choices: ['5 seconds', '10 seconds', '20 seconds', '30 seconds'],
            answerIndex: 2,
            explanation: 'Proper handwashing requires at least 20 seconds with soap and water.'
        },
        {
            id: '4',
            topic: 'triage',
            difficulty: 'medium',
            stem: 'A patient with chest pain and difficulty breathing should be triaged as:',
            choices: ['Low priority', 'Normal priority', 'Urgent priority', 'Can wait'],
            answerIndex: 2,
            explanation: 'Chest pain with breathing difficulty indicates potential cardiac emergency.'
        },
        {
            id: '5',
            topic: 'pharmacy',
            difficulty: 'hard',
            stem: 'FEFO stands for:',
            choices: ['First Expired, First Out', 'First Entry, First Out', 'Fast Expiry, Fast Out', 'Final Entry, Final Out'],
            answerIndex: 0,
            explanation: 'FEFO ensures medications closest to expiry are dispensed first.'
        },
        {
            id: '6',
            topic: 'vital_signs',
            difficulty: 'medium',
            stem: 'Normal body temperature range is:',
            choices: ['35.0-36.0°C', '36.1-37.2°C', '37.3-38.0°C', '38.1-39.0°C'],
            answerIndex: 1,
            explanation: 'Normal body temperature ranges from 36.1°C to 37.2°C.'
        },
        {
            id: '7',
            topic: 'workflow',
            difficulty: 'easy',
            stem: 'What is the correct patient flow sequence?',
            choices: ['Registration → Pharmacy → Vitals → Consult', 'Registration → Vitals → Consult → Pharmacy', 'Vitals → Registration → Consult → Pharmacy', 'Consult → Vitals → Registration → Pharmacy'],
            answerIndex: 1,
            explanation: 'Patients flow from Registration → Vitals → Consultation → Pharmacy.'
        },
        {
            id: '8',
            topic: 'safety',
            difficulty: 'medium',
            stem: 'If a patient reports an allergy to penicillin, you should:',
            choices: ['Give them penicillin anyway', 'Note it clearly in their record', 'Ignore the information', 'Ask them to prove it'],
            answerIndex: 1,
            explanation: 'Drug allergies must be clearly documented to prevent adverse reactions.'
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
            // Shuffle questions and take 5
            const shuffled = [...questionBank].sort(() => Math.random() - 0.5).slice(0, 5);
            const session = await GamificationService.startSession('quiz', currentUser.id, {
                totalQuestions: shuffled.length,
                startTime: new Date().toISOString()
            });
            setCurrentSession(session);
            setQuestions(shuffled);
            setCurrentQuestionIndex(0);
            setGameStarted(true);
            setTimeLeft(60);
            setAnswers([]);
            setSelectedAnswer(null);
            setStreak(0);
            setMaxStreak(0);
            setShowResult(false);
        }
        catch (error) {
            console.error('Error starting knowledge blitz:', error);
        }
    };
    const submitAnswer = () => {
        if (selectedAnswer === null)
            return;
        const isCorrect = selectedAnswer === questions[currentQuestionIndex].answerIndex;
        const newAnswers = [...answers, selectedAnswer];
        setAnswers(newAnswers);
        // Update streak
        const newStreak = isCorrect ? streak + 1 : 0;
        setStreak(newStreak);
        setMaxStreak(Math.max(maxStreak, newStreak));
        // Move to next question or end game
        if (currentQuestionIndex < questions.length - 1) {
            setTimeout(() => {
                setCurrentQuestionIndex(currentQuestionIndex + 1);
                setSelectedAnswer(null);
            }, 1000);
        }
        else {
            setTimeout(() => {
                endGame();
            }, 1000);
        }
    };
    const endGame = async () => {
        if (!currentSession || !currentUser)
            return;
        try {
            setShowResult(true);
            const correctAnswers = answers.filter((answer, index) => answer === questions[index]?.answerIndex).length;
            const accuracy = correctAnswers / questions.length;
            const timeBonus = timeLeft >= 10 ? 1.1 : 1.0;
            const streakBonus = maxStreak >= 5 ? 1.2 : 1.0;
            const wallet = await db.gamificationWallets.get(currentUser.id);
            const tokensEarned = GamificationService.calculateTokens(10, {
                accuracy,
                streak: wallet?.streakDays || 0,
                speedBonus: timeBonus,
                qualityBonus: streakBonus
            });
            await GamificationService.completeSession(currentSession.id, {
                score: correctAnswers,
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
    if (!gameStarted) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(AcademicCapIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Knowledge Blitz" }), _jsx("p", { className: "text-gray-600", children: "60-second rapid-fire quiz on protocols and procedures" })] })] }), _jsx("div", { className: "card max-w-2xl mx-auto", children: _jsxs("div", { className: "text-center py-8", children: [_jsx(AcademicCapIcon, { className: "h-16 w-16 mx-auto text-purple-500 mb-4" }), _jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Ready for the Blitz?" }), _jsx("div", { className: "bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6", children: _jsxs("div", { className: "text-sm text-purple-800", children: [_jsx("div", { className: "font-medium mb-2", children: "\u26A1 Challenge Rules:" }), _jsxs("ul", { className: "text-xs space-y-1 text-purple-700 text-left", children: [_jsx("li", { children: "\u2022 5 random questions in 60 seconds" }), _jsx("li", { children: "\u2022 +2 tokens per correct answer" }), _jsx("li", { children: "\u2022 +5 bonus for 5-question streak" }), _jsx("li", { children: "\u2022 +10% speed bonus if 10+ seconds remain" }), _jsx("li", { children: "\u2022 Topics: vitals, meds, protocols, safety" })] })] }) }), _jsx("button", { onClick: startGame, className: "btn-primary", children: "Start Knowledge Blitz" })] }) })] }));
    }
    if (showResult) {
        const correctAnswers = answers.filter((answer, index) => answer === questions[index]?.answerIndex).length;
        const accuracy = Math.round((correctAnswers / questions.length) * 100);
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(AcademicCapIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Knowledge Blitz Complete!" }), _jsx("p", { className: "text-gray-600", children: "Great job! Here are your results:" })] })] }), _jsx("div", { className: "card max-w-2xl mx-auto", children: _jsxs("div", { className: "text-center py-8", children: [_jsx("div", { className: "text-6xl mb-4", children: accuracy >= 80 ? '🏆' : accuracy >= 60 ? '🥈' : '🥉' }), _jsxs("div", { className: "grid grid-cols-3 gap-6 mb-6", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-3xl font-bold text-primary", children: [correctAnswers, "/", questions.length] }), _jsx("div", { className: "text-sm text-gray-600", children: "Correct" })] }), _jsxs("div", { children: [_jsxs("div", { className: "text-3xl font-bold text-orange-600", children: [accuracy, "%"] }), _jsx("div", { className: "text-sm text-gray-600", children: "Accuracy" })] }), _jsxs("div", { children: [_jsx("div", { className: "text-3xl font-bold text-red-600", children: maxStreak }), _jsx("div", { className: "text-sm text-gray-600", children: "Max Streak" })] })] }), _jsx("div", { className: "bg-green-50 border border-green-200 rounded-lg p-4 mb-6", children: _jsx("p", { className: "text-green-800 font-medium", children: "\uD83C\uDF89 Session completed! Waiting for supervisor approval to mint tokens." }) }), _jsx("button", { onClick: () => navigate('/games'), className: "btn-primary", children: "Back to Game Hub" })] }) })] }));
    }
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion)
        return null;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(AcademicCapIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Knowledge Blitz" }), _jsxs("p", { className: "text-gray-600", children: ["Question ", currentQuestionIndex + 1, " of ", questions.length] })] })] }), _jsxs("div", { className: "flex items-center space-x-6", children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-primary", children: answers.filter((answer, index) => answer === questions[index]?.answerIndex).length }), _jsx("div", { className: "text-sm text-gray-600", children: "Correct" })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-orange-600", children: streak }), _jsx("div", { className: "text-sm text-gray-600", children: "Streak" })] }), _jsxs("div", { className: "text-center flex items-center space-x-1", children: [_jsx(ClockIcon, { className: "h-5 w-5 text-red-500" }), _jsxs("div", { className: `text-2xl font-bold ${timeLeft <= 10 ? 'text-red-600 animate-pulse' : 'text-red-600'}`, children: [timeLeft, "s"] })] })] })] }), _jsxs("div", { className: "card max-w-3xl mx-auto", children: [_jsxs("div", { className: "mb-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("span", { className: "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 capitalize", children: [currentQuestion.topic.replace('_', ' '), " \u2022 ", currentQuestion.difficulty] }), _jsxs("div", { className: "text-sm text-gray-500", children: [currentQuestionIndex + 1, "/", questions.length] })] }), _jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: currentQuestion.stem })] }), _jsx("div", { className: "space-y-3 mb-6", children: currentQuestion.choices.map((choice, index) => (_jsx("button", { onClick: () => setSelectedAnswer(index), className: `w-full text-left p-4 rounded-lg border transition-all ${selectedAnswer === index
                                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`, children: _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: `w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedAnswer === index
                                            ? 'border-primary bg-primary text-white'
                                            : 'border-gray-300'}`, children: _jsx("span", { className: "text-sm font-medium", children: String.fromCharCode(65 + index) }) }), _jsx("span", { className: "text-gray-900", children: choice })] }) }, index))) }), _jsx("div", { className: "text-center", children: _jsx("button", { onClick: submitAnswer, disabled: selectedAnswer === null, className: "btn-primary disabled:opacity-50 disabled:cursor-not-allowed", children: "Submit Answer" }) })] }), _jsx("div", { className: "max-w-3xl mx-auto", children: _jsx("div", { className: "flex justify-center space-x-2", children: questions.map((_, index) => (_jsx("div", { className: `w-3 h-3 rounded-full ${index < currentQuestionIndex
                            ? 'bg-green-500'
                            : index === currentQuestionIndex
                                ? 'bg-primary'
                                : 'bg-gray-300'}` }, index))) }) })] }));
}
