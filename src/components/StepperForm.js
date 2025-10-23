import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// @ts-nocheck
import { useState } from 'react';
import { useT } from '@/hooks/useT';
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';
export function StepperForm({ steps, onComplete, onCancel, className = '' }) {
    const { t, speak } = useT();
    const [currentStep, setCurrentStep] = useState(0);
    const canGoNext = currentStep < steps.length - 1;
    const canGoPrev = currentStep > 0;
    const isLastStep = currentStep === steps.length - 1;
    const currentStepData = steps[currentStep];
    const handleNext = async () => {
        if (isLastStep) {
            onComplete();
        }
        else {
            setCurrentStep(currentStep + 1);
            // Play audio for next step
            const nextStep = steps[currentStep + 1];
            if (nextStep.audioKey) {
                try {
                    await speak(nextStep.audioKey);
                }
                catch (error) {
                    console.warn('Audio playback failed:', error);
                }
            }
        }
    };
    const handlePrev = () => {
        if (canGoPrev) {
            setCurrentStep(currentStep - 1);
        }
    };
    const playStepAudio = async () => {
        if (currentStepData.audioKey) {
            try {
                await speak(currentStepData.audioKey);
            }
            catch (error) {
                console.warn('Audio playback failed:', error);
            }
        }
    };
    return (_jsxs("div", { className: `max-w-2xl mx-auto ${className}`, children: [_jsxs("div", { className: "mb-8", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("span", { className: "text-sm font-medium text-gray-600", children: [t('stepper.step'), " ", currentStep + 1, " ", t('common.of'), " ", steps.length] }), _jsxs("span", { className: "text-sm text-gray-500", children: [Math.round(((currentStep + 1) / steps.length) * 100), "%"] })] }), _jsx("div", { className: "w-full bg-gray-200 rounded-full h-3", children: _jsx("div", { className: "bg-primary h-3 rounded-full transition-all duration-300", style: { width: `${((currentStep + 1) / steps.length) * 100}%` } }) }), _jsx("div", { className: "flex justify-between mt-2", children: steps.map((step, index) => (_jsx("div", { className: `w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${index < currentStep
                                ? 'bg-green-500 text-white'
                                : index === currentStep
                                    ? 'bg-primary text-white'
                                    : 'bg-gray-300 text-gray-600'}`, children: index < currentStep ? (_jsx(CheckIcon, { className: "h-4 w-4" })) : (index + 1) }, step.id))) })] }), _jsx("div", { className: "text-center mb-6", children: _jsxs("div", { className: "flex items-center justify-center space-x-3 mb-2", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: currentStepData.title }), currentStepData.audioKey && (_jsx("button", { onClick: playStepAudio, className: "p-2 bg-blue-100 text-blue-600 rounded-full hover:bg-blue-200 transition-colors touch-target", title: t('accessibility.playAudio'), children: _jsx(SpeakerWaveIcon, { className: "h-5 w-5" }) }))] }) }), _jsx("div", { className: "card mb-8", children: currentStepData.component }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("button", { onClick: handlePrev, disabled: !canGoPrev, className: "btn-secondary inline-flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed", children: [_jsx(ChevronLeftIcon, { className: "h-5 w-5" }), _jsx("span", { children: t('action.back') })] }), _jsxs("div", { className: "flex space-x-4", children: [onCancel && (_jsx("button", { onClick: onCancel, className: "btn-secondary", children: t('action.cancel') })), _jsxs("button", { onClick: handleNext, disabled: currentStepData.isValid === false, className: "btn-primary inline-flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed", children: [_jsx("span", { children: isLastStep ? t('action.complete') : t('action.next') }), !isLastStep && _jsx(ChevronRightIcon, { className: "h-5 w-5" })] })] })] })] }));
}
