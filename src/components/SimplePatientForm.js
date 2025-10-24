import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useT } from '@/hooks/useT';
import { StepperForm } from '@/components/StepperForm';
import { VisualNumberInput } from '@/components/VisualNumberInput';
import { usePatientsStore } from '@/stores/patients';
import { NIGERIAN_STATES, LGAS_BY_STATE, formatPhoneNG } from '@/utils/nigeria';
import { UserIcon, CameraIcon, PhoneIcon, MapPinIcon, IdentificationIcon } from '@heroicons/react/24/outline';
export function SimplePatientForm({ onSuccess, onCancel, className }) {
    const { t, speak } = useT();
    const { addPatient } = usePatientsStore();
    const [formData, setFormData] = useState({
        givenName: '',
        familyName: '',
        sex: '',
        age: 25,
        phone: '',
        address: '',
        state: '',
        lga: '',
        photo: null
    });
    const [loading, setLoading] = useState(false);
    const handlePhotoCapture = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const result = event.target?.result;
                // Create thumbnail
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxSize = 200;
                    let { width, height } = img;
                    if (width > height) {
                        if (width > maxSize) {
                            height = (height * maxSize) / width;
                            width = maxSize;
                        }
                    }
                    else {
                        if (height > maxSize) {
                            width = (width * maxSize) / height;
                            height = maxSize;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx?.drawImage(img, 0, 0, width, height);
                    const thumbnail = canvas.toDataURL('image/jpeg', 0.8);
                    setFormData(prev => ({ ...prev, photo: thumbnail }));
                };
                img.src = result;
            };
            reader.readAsDataURL(file);
        }
    };
    const calculateDOB = (age) => {
        const today = new Date();
        const birthYear = today.getFullYear() - age;
        return `${birthYear}-01-01`; // Approximate DOB
    };
    const handleComplete = async () => {
        setLoading(true);
        try {
            const dob = calculateDOB(formData.age);
            const formattedPhone = formatPhoneNG(formData.phone);
            const patientId = await addPatient({
                givenName: formData.givenName,
                familyName: formData.familyName,
                sex: formData.sex,
                dob,
                phone: formattedPhone,
                address: formData.address,
                state: formData.state,
                lga: formData.lga,
                photoUrl: formData.photo || undefined
            });
            onSuccess?.(patientId);
        }
        catch (error) {
            console.error('Error registering patient:', error);
            alert(t('error.registrationFailed'));
        }
        finally {
            setLoading(false);
        }
    };
    const steps = [
        {
            id: 'photo',
            title: t('patient.photo'),
            audioKey: 'patient.photo',
            isValid: true,
            component: (_jsxs("div", { className: "text-center space-y-6", children: [_jsxs("div", { className: "relative mx-auto w-32 h-32", children: [formData.photo ? (_jsx("img", { src: formData.photo, alt: "Patient", className: "w-32 h-32 rounded-full object-cover border-4 border-gray-200" })) : (_jsx("div", { className: "w-32 h-32 rounded-full bg-gray-100 flex items-center justify-center border-4 border-gray-200", children: _jsx(UserIcon, { className: "h-16 w-16 text-gray-400" }) })), _jsxs("label", { className: "absolute bottom-0 right-0 bg-primary text-white rounded-full p-3 cursor-pointer hover:bg-primary/90 transition-colors touch-target-large shadow-lg", children: [_jsx(CameraIcon, { className: "h-6 w-6" }), _jsx("input", { type: "file", accept: "image/*", capture: "user", onChange: handlePhotoCapture, className: "hidden" })] })] }), _jsx("p", { className: "text-lg text-gray-600", children: t('simple.tapCameraToAddPhoto') })] }))
        },
        {
            id: 'names',
            title: t('patient.names'),
            audioKey: 'patient.names',
            isValid: formData.givenName.trim() && formData.familyName.trim(),
            component: (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2", children: [_jsx(IdentificationIcon, { className: "h-6 w-6 text-primary" }), _jsxs("span", { children: [t('patient.givenName'), " *"] })] }), _jsx("input", { type: "text", value: formData.givenName, onChange: (e) => setFormData(prev => ({ ...prev, givenName: e.target.value })), className: "input-field text-xl", placeholder: t('simple.enterFirstName'), autoFocus: true })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2", children: [_jsx(IdentificationIcon, { className: "h-6 w-6 text-primary" }), _jsxs("span", { children: [t('patient.familyName'), " *"] })] }), _jsx("input", { type: "text", value: formData.familyName, onChange: (e) => setFormData(prev => ({ ...prev, familyName: e.target.value })), className: "input-field text-xl", placeholder: t('simple.enterLastName') })] })] }))
        },
        {
            id: 'demographics',
            title: t('patient.demographics'),
            audioKey: 'patient.demographics',
            isValid: formData.sex && formData.age > 0,
            component: (_jsxs("div", { className: "space-y-8", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-4 text-center", children: [t('patient.sex'), " *"] }), _jsx("div", { className: "grid grid-cols-3 gap-4", children: [
                                    { value: 'male', label: t('patient.male'), icon: '👨', color: 'bg-blue-100 border-blue-300 text-blue-800' },
                                    { value: 'female', label: t('patient.female'), icon: '👩', color: 'bg-pink-100 border-pink-300 text-pink-800' },
                                    { value: 'other', label: t('patient.other'), icon: '👤', color: 'bg-gray-100 border-gray-300 text-gray-800' }
                                ].map((option) => (_jsxs("button", { type: "button", onClick: () => setFormData(prev => ({ ...prev, sex: option.value })), className: `p-6 rounded-xl border-2 transition-all touch-target-large ${formData.sex === option.value
                                        ? `${option.color} ring-2 ring-primary/20`
                                        : 'bg-white border-gray-200 hover:border-gray-300'}`, children: [_jsx("div", { className: "text-4xl mb-2", children: option.icon }), _jsx("div", { className: "text-lg font-medium", children: option.label })] }, option.value))) })] }), _jsx(VisualNumberInput, { value: formData.age, onChange: (age) => setFormData(prev => ({ ...prev, age })), min: 0, max: 120, label: t('patient.age'), unit: t('common.years'), showDots: formData.age <= 10 })] }))
        },
        {
            id: 'contact',
            title: t('patient.contact'),
            audioKey: 'patient.contact',
            isValid: formData.phone.trim(),
            component: (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2", children: [_jsx(PhoneIcon, { className: "h-6 w-6 text-primary" }), _jsxs("span", { children: [t('patient.phone'), " *"] })] }), _jsx("input", { type: "tel", value: formData.phone, onChange: (e) => setFormData(prev => ({ ...prev, phone: e.target.value })), className: "input-field text-xl", placeholder: "08012345678" }), _jsx("p", { className: "text-sm text-gray-600 mt-2", children: t('simple.phoneExample') })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3 flex items-center space-x-2", children: [_jsx(MapPinIcon, { className: "h-6 w-6 text-primary" }), _jsx("span", { children: t('patient.address') })] }), _jsx("textarea", { value: formData.address, onChange: (e) => setFormData(prev => ({ ...prev, address: e.target.value })), className: "input-field text-lg", rows: 3, placeholder: t('simple.enterAddress') })] })] }))
        },
        {
            id: 'location',
            title: t('patient.location'),
            audioKey: 'patient.location',
            isValid: formData.state && formData.lga,
            component: (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: [t('patient.state'), " *"] }), _jsxs("select", { value: formData.state, onChange: (e) => {
                                    setFormData(prev => ({ ...prev, state: e.target.value, lga: '' }));
                                }, className: "input-field text-xl", children: [_jsx("option", { value: "", children: t('simple.selectState') }), NIGERIAN_STATES.map((state) => (_jsx("option", { value: state, children: state }, state)))] })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: [t('patient.lga'), " *"] }), _jsxs("select", { value: formData.lga, onChange: (e) => setFormData(prev => ({ ...prev, lga: e.target.value })), className: "input-field text-xl", disabled: !formData.state, children: [_jsx("option", { value: "", children: t('simple.selectLGA') }), (LGAS_BY_STATE[formData.state] || []).map((lga) => (_jsx("option", { value: lga, children: lga }, lga)))] })] })] }))
        }
    ];
    return (_jsx(StepperForm, { steps: steps, onComplete: handleComplete, onCancel: onCancel, className: className }));
}
