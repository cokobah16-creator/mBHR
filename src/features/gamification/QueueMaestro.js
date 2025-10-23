import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useQueue } from '@/stores/queue';
import { gamificationDb, generateGameId, calculateTokens, updateWallet, checkBadgeEligibility } from '@/db/gamification';
import { useLiveQuery } from 'dexie-react-hooks';
import { db as mbhrDb } from '@/db/mbhr';
import { PlayIcon, CheckIcon, ClockIcon, BoltIcon, TrophyIcon, FireIcon } from '@heroicons/react/24/outline';
const STAGES = ['registration', 'vitals', 'consult', 'pharmacy'];
export default function QueueMaestro({ onComplete, onCancel }) {
    const { currentUser } = useAuthStore();
    const { callNext, completeCurrent } = useQueue();
    const [selectedStage, setSelectedStage] = useState('registration');
    const [currentAttempt, setCurrentAttempt] = useState(null);
    const [sessionStats, setSessionStats] = useState({
        patientsProcessed: 0,
        averageTime: 0,
        tokensEarned: 0,
        speedBonuses: 0
    });
    // Live query for tickets in selected stage
    const stageTickets = useLiveQuery(() => mbhrDb.tickets
        .where('currentStage')
        .equals(selectedStage)
        .toArray(), [selectedStage], []);
    const waiting = stageTickets?.filter(t => t.state === 'waiting') || [];
    const inProgress = stageTickets?.find(t => t.state === 'in_progress');
    useEffect(() => {
        // Load any existing in-progress attempt
        loadCurrentAttempt();
    }, [currentUser]);
    const loadCurrentAttempt = async () => {
        if (!currentUser)
            return;
        try {
            const attempt = await gamificationDb.game_attempts
                .where('actorId')
                .equals(currentUser.id)
                .and(a => a.taskCode === 'queue_maestro' && a.status === 'in_progress')
                .first();
            setCurrentAttempt(attempt || null);
        }
        catch (error) {
            console.error('Error loading current attempt:', error);
        }
    };
    const startQuest = async () => {
        if (!currentUser || currentAttempt)
            return;
        try {
            const attempt = {
                id: generateGameId(),
                taskCode: 'queue_maestro',
                actorId: currentUser.id,
                payloadJson: JSON.stringify({
                    stage: selectedStage,
                    startedAt: new Date().toISOString(),
                    patientsProcessed: 0,
                    totalServiceTime: 0
                }),
                startedAt: new Date().toISOString(),
                status: 'in_progress',
                _dirty: 1
            };
            await gamificationDb.game_attempts.add(attempt);
            setCurrentAttempt(attempt);
        }
        catch (error) {
            console.error('Error starting quest:', error);
        }
    };
    const processNextPatient = async () => {
        if (!currentAttempt || !currentUser)
            return;
        const startTime = new Date();
        try {
            // Call next patient
            const nextPatient = await callNext(selectedStage);
            if (!nextPatient) {
                alert('No patients waiting in this stage');
                return;
            }
            // Simulate processing time (in real app, this would be actual work)
            // For demo, we'll use a random time between 2-8 minutes
            const processingTime = Math.random() * 6 + 2; // 2-8 minutes
            // In real implementation, this would wait for actual completion
            // For demo, we'll simulate it
            setTimeout(async () => {
                await completePatientProcessing(nextPatient.id, processingTime);
            }, 2000); // 2 second demo delay
        }
        catch (error) {
            console.error('Error processing patient:', error);
        }
    };
    const completePatientProcessing = async (patientId, serviceTimeMinutes) => {
        if (!currentAttempt || !currentUser)
            return;
        try {
            // Complete current patient in queue system
            await completeCurrent(selectedStage, serviceTimeMinutes * 60); // Convert to seconds
            // Update attempt payload
            const payload = JSON.parse(currentAttempt.payloadJson);
            payload.patientsProcessed += 1;
            payload.totalServiceTime += serviceTimeMinutes;
            // Calculate performance metrics
            const averageTime = payload.totalServiceTime / payload.patientsProcessed;
            const targetTime = 4; // 4 minutes target
            const speedBonus = averageTime <= targetTime ? 1.2 : 1.0;
            // Update session stats
            setSessionStats(prev => ({
                patientsProcessed: payload.patientsProcessed,
                averageTime: averageTime,
                tokensEarned: prev.tokensEarned,
                speedBonuses: prev.speedBonuses + (speedBonus > 1 ? 1 : 0)
            }));
            // Update attempt
            await gamificationDb.game_attempts.update(currentAttempt.id, {
                payloadJson: JSON.stringify(payload),
                _dirty: 1
            });
            // Refresh current attempt
            const updatedAttempt = await gamificationDb.game_attempts.get(currentAttempt.id);
            setCurrentAttempt(updatedAttempt || null);
        }
        catch (error) {
            console.error('Error completing patient processing:', error);
        }
    };
    const completeQuest = async () => {
        if (!currentAttempt || !currentUser)
            return;
        try {
            const payload = JSON.parse(currentAttempt.payloadJson);
            const finishedAt = new Date().toISOString();
            // Calculate final score and tokens
            const baseTokens = 15; // Base tokens for queue maestro
            const patientsProcessed = payload.patientsProcessed;
            const averageTime = payload.totalServiceTime / Math.max(1, patientsProcessed);
            const targetTime = 4; // 4 minutes target
            // Performance multipliers
            const speedBonus = averageTime <= targetTime ? 1.2 : averageTime <= 6 ? 1.0 : 0.8;
            const volumeBonus = patientsProcessed >= 5 ? 1.1 : 1.0;
            // Get user's current streak for streak bonus
            const wallet = await gamificationDb.wallets.get(currentUser.id);
            const streakDays = wallet?.streakDays || 0;
            const finalTokens = calculateTokens(baseTokens * patientsProcessed, {
                streak: streakDays,
                accuracy: 1.0, // Assume 100% accuracy for now
                speedBonus,
                qualityBonus: volumeBonus
            });
            // Update attempt as completed
            await gamificationDb.game_attempts.update(currentAttempt.id, {
                finishedAt,
                status: 'completed',
                score: Math.round(averageTime * 100) / 100, // Average service time as score
                tokens: finalTokens,
                multipliersJson: JSON.stringify({
                    speedBonus,
                    volumeBonus,
                    streakBonus: 1 + Math.min(streakDays, 5) * 0.1
                }),
                _dirty: 1
            });
            // Update wallet
            await updateWallet(currentUser.id, finalTokens, true);
            // Check for new badges
            const newBadges = await checkBadgeEligibility(currentUser.id, 'queue_maestro');
            // Update session stats
            setSessionStats(prev => ({
                ...prev,
                tokensEarned: finalTokens
            }));
            // Clear current attempt
            setCurrentAttempt(null);
            // Notify completion
            if (onComplete) {
                onComplete(finalTokens, newBadges);
            }
            // Show completion message
            alert(`🎉 Quest Complete!\n\nPatients Processed: ${patientsProcessed}\nAverage Time: ${averageTime.toFixed(1)} min\nTokens Earned: ${finalTokens}\n${newBadges.length > 0 ? `New Badges: ${newBadges.join(', ')}` : ''}`);
        }
        catch (error) {
            console.error('Error completing quest:', error);
        }
    };
    const cancelQuest = async () => {
        if (!currentAttempt)
            return;
        try {
            await gamificationDb.game_attempts.delete(currentAttempt.id);
            setCurrentAttempt(null);
            setSessionStats({
                patientsProcessed: 0,
                averageTime: 0,
                tokensEarned: 0,
                speedBonuses: 0
            });
            if (onCancel) {
                onCancel();
            }
        }
        catch (error) {
            console.error('Error canceling quest:', error);
        }
    };
    const payload = currentAttempt ? JSON.parse(currentAttempt.payloadJson) : null;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "text-3xl", children: "\uD83C\uDFE5" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Queue Maestro" }), _jsx("p", { className: "text-gray-600", children: "Process patients efficiently through care stages" })] })] }), currentAttempt && (_jsxs("div", { className: "flex items-center space-x-4", children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-primary", children: payload?.patientsProcessed || 0 }), _jsx("div", { className: "text-sm text-gray-600", children: "Processed" })] }), _jsxs("div", { className: "text-center", children: [_jsxs("div", { className: "text-2xl font-bold text-orange-600", children: [payload?.patientsProcessed > 0 ? (payload.totalServiceTime / payload.patientsProcessed).toFixed(1) : '0.0', "m"] }), _jsx("div", { className: "text-sm text-gray-600", children: "Avg Time" })] })] }))] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Select Stage" }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3", children: STAGES.map(stage => {
                            const stageCount = stageTickets?.filter(t => t.currentStage === stage && t.state !== 'done').length || 0;
                            return (_jsxs("button", { onClick: () => setSelectedStage(stage), disabled: !!currentAttempt, className: `p-4 rounded-lg border font-medium capitalize transition-colors ${selectedStage === stage
                                    ? 'bg-primary text-white border-primary'
                                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'} ${currentAttempt ? 'opacity-50 cursor-not-allowed' : ''}`, children: [_jsx("div", { className: "text-lg font-bold", children: stageCount }), _jsx("div", { className: "text-sm", children: stage })] }, stage));
                        }) })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "Quest Status" }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(BoltIcon, { className: "h-5 w-5 text-yellow-500" }), _jsx("span", { className: "font-medium text-primary", children: "15 tokens per patient" })] })] }), !currentAttempt ? (_jsxs("div", { className: "text-center py-8", children: [_jsx(TrophyIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsxs("p", { className: "text-gray-600 mb-6", children: ["Ready to start processing patients in ", selectedStage, "?"] }), _jsxs("button", { onClick: startQuest, disabled: waiting.length === 0, className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(PlayIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Start Quest" })] }), waiting.length === 0 && (_jsx("p", { className: "text-sm text-gray-500 mt-2", children: "No patients waiting in this stage" }))] })) : (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "font-medium text-blue-800", children: "Quest in Progress" }), _jsxs("span", { className: "text-sm text-blue-600", children: ["Stage: ", selectedStage] })] }), _jsxs("div", { className: "grid grid-cols-3 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "text-blue-600", children: "Patients:" }), _jsx("span", { className: "ml-2 font-medium", children: payload?.patientsProcessed || 0 })] }), _jsxs("div", { children: [_jsx("span", { className: "text-blue-600", children: "Avg Time:" }), _jsxs("span", { className: "ml-2 font-medium", children: [payload?.patientsProcessed > 0 ? (payload.totalServiceTime / payload.patientsProcessed).toFixed(1) : '0.0', "m"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-blue-600", children: "Target:" }), _jsx("span", { className: "ml-2 font-medium", children: "\u22644.0m" })] })] })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("div", { children: inProgress ? (_jsxs("div", { className: "flex items-center space-x-2 text-yellow-600", children: [_jsx(ClockIcon, { className: "h-5 w-5" }), _jsxs("span", { children: ["Patient ", inProgress.number, " in progress"] })] })) : (_jsx("div", { className: "flex items-center space-x-2 text-gray-600", children: _jsx("span", { children: "Ready for next patient" }) })) }), _jsxs("div", { className: "text-sm text-gray-500", children: [waiting.length, " waiting"] })] }), _jsxs("div", { className: "flex space-x-4", children: [_jsxs("button", { onClick: processNextPatient, disabled: waiting.length === 0 || !!inProgress, className: "btn-primary flex-1 inline-flex items-center justify-center space-x-2", children: [_jsx(PlayIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Process Next Patient" })] }), payload?.patientsProcessed > 0 && (_jsxs("button", { onClick: completeQuest, className: "btn-secondary inline-flex items-center space-x-2", children: [_jsx(CheckIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Complete Quest" })] })), _jsx("button", { onClick: cancelQuest, className: "btn-secondary text-red-600 hover:bg-red-50", children: "Cancel" })] })] }))] }), _jsxs("div", { className: "card bg-green-50 border-green-200", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-3", children: [_jsx(FireIcon, { className: "h-5 w-5 text-green-600" }), _jsx("h4", { className: "font-medium text-green-800", children: "Performance Tips" })] }), _jsxs("div", { className: "text-sm text-green-700 space-y-1", children: [_jsx("p", { children: "\u2022 Keep service time \u22644 minutes per patient for speed bonus" }), _jsx("p", { children: "\u2022 Process 5+ patients for volume bonus" }), _jsx("p", { children: "\u2022 Maintain daily streaks for streak multiplier" }), _jsx("p", { children: "\u2022 Clean handoffs (no patient returns) boost your score" })] })] })] }));
}
