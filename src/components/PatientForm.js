import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { usePatientsStore } from '@/stores/patients';
import { PatientDedupeModal } from '@/components/PatientDedupeModal';
import { AudioButton } from '@/components/AudioButton';
import { PhotoCapture } from '@/components/PhotoCapture';
import { NIGERIAN_STATES, LGAS_BY_STATE, formatPhoneNG, validatePhoneNG } from '@/utils/nigeria';
import { CameraIcon, UserIcon } from '@heroicons/react/24/outline';
const patientSchema = z.object({
    givenName: z.string().min(1, 'Given name is required'),
    familyName: z.string().min(1, 'Family name is required'),
    sex: z.enum(['male', 'female', 'other']),
    dob: z.string().min(1, 'Date of birth is required'),
    phone: z.string().refine(validatePhoneNG, 'Invalid Nigerian phone number'),
    address: z.string().min(1, 'Address is required'),
    state: z.string().min(1, 'State is required'),
    lga: z.string().min(1, 'LGA is required'),
    familyId: z.string().optional()
});
export function PatientForm({ onSuccess, onCancel }) {
    const { t } = useTranslation();
    const { addPatient } = usePatientsStore();
    const [loading, setLoading] = useState(false);
    const [photo, setPhoto] = useState(null);
    const [showPhotoCapture, setShowPhotoCapture] = useState(false);
    const [selectedState, setSelectedState] = useState('');
    const [showDedupeModal, setShowDedupeModal] = useState(false);
    const [dedupeData, setDedupeData] = useState(null);
    const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
        resolver: zodResolver(patientSchema)
    });
    const watchedState = watch('state');
    const availableLGAs = LGAS_BY_STATE[watchedState] || [];
    const handlePhotoCapture = (photoDataUrl) => {
        setPhoto(photoDataUrl);
        setShowPhotoCapture(false);
    };
    const handleRemovePhoto = () => {
        setPhoto(null);
    };
    const onSubmit = async (data) => {
        setLoading(true);
        console.log('PatientForm: Submitting patient data:', data);
        try {
            const formattedPhone = formatPhoneNG(data.phone);
            console.log('PatientForm: Formatted phone:', formattedPhone);
            const patientData = {
                ...data,
                phone: formattedPhone,
                photoUrl: photo || undefined
            };
            const patientId = await addPatient(patientData);
            console.log('PatientForm: Patient created with ID:', patientId);
            onSuccess?.(patientId);
        }
        catch (error) {
            console.error('Error adding patient:', error);
            // Check if it's a duplicate error
            if (error.message.startsWith('DUPLICATES_FOUND:')) {
                const duplicateData = JSON.parse(error.message.replace('DUPLICATES_FOUND:', ''));
                setDedupeData(duplicateData);
                setShowDedupeModal(true);
            }
            else {
                alert('Failed to register patient: ' + error.message);
            }
        }
        finally {
            setLoading(false);
        }
    };
    const handleDedupeResolve = async (action, winnerId) => {
        setShowDedupeModal(false);
        if (action === 'create_new' && dedupeData) {
            // Force create new patient (bypass duplicate check)
            try {
                const patientId = await addPatient({
                    ...dedupeData.patient,
                    photoUrl: photo || undefined,
                    // Add a suffix to make it unique
                    givenName: dedupeData.patient.givenName + ' (New)'
                });
                onSuccess?.(patientId);
            }
            catch (error) {
                console.error('Error creating new patient:', error);
                alert('Failed to create new patient');
            }
        }
        else if (action === 'merge' && winnerId) {
            // Use existing patient
            onSuccess?.(winnerId);
        }
        setDedupeData(null);
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-6", children: [_jsx(UserIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: t('patient.register') })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col items-center space-y-4", children: [_jsxs("div", { className: "relative", children: [photo ? (_jsx("img", { src: photo, alt: "Patient", className: "w-32 h-32 rounded-full object-cover border-4 border-gray-200" })) : (_jsx("div", { className: "w-32 h-32 rounded-full bg-gray-100 flex items-center justify-center border-4 border-gray-200", children: _jsx(UserIcon, { className: "h-16 w-16 text-gray-400" }) })), photo && (_jsx("button", { type: "button", onClick: handleRemovePhoto, className: "absolute top-0 right-0 bg-red-500 text-white rounded-full p-1 m-1", children: "\u00D7" })), _jsx("button", { type: "button", onClick: () => setShowPhotoCapture(true), className: "absolute bottom-0 right-0 bg-primary text-white rounded-full p-2 cursor-pointer hover:bg-primary/90 transition-colors touch-target", children: _jsx(CameraIcon, { className: "h-5 w-5" }) })] }), _jsxs("p", { className: "text-sm text-gray-600", children: ["Tap camera to ", photo ? 'change' : 'add', " photo"] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.givenName'), " *"] }), _jsx("input", { ...register('givenName'), className: "input-field", placeholder: "Enter given name" }), errors.givenName && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.givenName.message }))] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.familyName'), " *"] }), _jsx("input", { ...register('familyName'), className: "input-field", placeholder: "Enter family name" }), errors.familyName && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.familyName.message }))] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Sex *" }), _jsxs("select", { ...register('sex'), className: "input-field", children: [_jsx("option", { value: "", children: "Select sex" }), _jsx("option", { value: "male", children: "Male" }), _jsx("option", { value: "female", children: "Female" }), _jsx("option", { value: "other", children: "Other" })] }), errors.sex && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.sex.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Date of Birth *" }), _jsx("input", { ...register('dob'), type: "date", className: "input-field", max: new Date().toISOString().split('T')[0] }), errors.dob && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.dob.message }))] })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.phone'), " *"] }), _jsx("input", { ...register('phone'), type: "tel", className: "input-field", placeholder: "08012345678 or +2348012345678" }), errors.phone && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.phone.message }))] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.address'), " *"] }), _jsx("textarea", { ...register('address'), className: "input-field", rows: 3, placeholder: "Enter full address" }), errors.address && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.address.message }))] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.state'), " *"] }), _jsxs("select", { ...register('state'), onChange: (e) => {
                                                        setSelectedState(e.target.value);
                                                        setValue('lga', ''); // Reset LGA when state changes
                                                    }, className: "input-field", children: [_jsx("option", { value: "", children: "Select state" }), NIGERIAN_STATES.map((state) => (_jsx("option", { value: state, children: state }, state)))] }), errors.state && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.state.message }))] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.lga'), " *"] }), _jsxs("select", { ...register('lga'), className: "input-field", disabled: !watchedState, children: [_jsx("option", { value: "", children: "Select LGA" }), availableLGAs.map((lga) => (_jsx("option", { value: lga, children: lga }, lga)))] }), errors.lga && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.lga.message }))] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Family ID (Optional)" }), _jsx("input", { ...register('familyId'), className: "input-field", placeholder: "Link to existing family member" })] }), _jsxs("div", { className: "flex space-x-4 pt-6", children: [_jsx(AudioButton, { audioKey: "action.register", fallbackText: "Register Patient", type: "submit", disabled: loading, className: "btn-primary flex-1", children: loading ? 'Registering...' : 'Register Patient' }), onCancel && (_jsx(AudioButton, { audioKey: "action.cancel", fallbackText: "Cancel", type: "button", onClick: onCancel, className: "btn-secondary flex-1", children: "Cancel" }))] })] })] }) }), showDedupeModal && dedupeData && (_jsx(PatientDedupeModal, { newPatient: dedupeData.patient, candidates: dedupeData.candidates, onResolve: handleDedupeResolve, onCancel: () => {
                    setShowDedupeModal(false);
                    setDedupeData(null);
                    setLoading(false);
                } })), showPhotoCapture && (_jsx(PhotoCapture, { onCapture: handlePhotoCapture, onCancel: () => setShowPhotoCapture(false), currentPhoto: photo || undefined }))] }));
}
