import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { usePatientsStore } from '@/stores/patients';
import { PatientDedupeModal } from '@/components/PatientDedupeModal';
import { AudioButton } from '@/components/AudioButton';
import { PhotoCapture } from '@/components/PhotoCapture';
import { NIGERIAN_STATES, LGAS_BY_STATE } from '@/utils/nigeria';
import { normalizePhone } from '@/utils/phone';
import { patientSchema } from '@/validation/schemas';
import { CameraIcon, UserIcon } from '@heroicons/react/24/outline';
import { enrollPatientInPortal } from '@/services/unifiedPortalEnrollment';
export function PatientForm({ onSuccess, onCancel }) {
    const { t } = useTranslation();
    const { addPatient } = usePatientsStore();
    const [loading, setLoading] = useState(false);
    const [photo, setPhoto] = useState(null);
    const [showPhotoCapture, setShowPhotoCapture] = useState(false);
    const [showDedupeModal, setShowDedupeModal] = useState(false);
    const [dedupeData, setDedupeData] = useState(null);
    const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
        resolver: zodResolver(patientSchema)
    });
    const watchedState = watch('state');
    const availableLGAs = LGAS_BY_STATE[watchedState] || [];
    // Auto-enable portal when contact info is entered
    useEffect(() => {
        const { phone, email } = watch();
        const hasContact = (phone && phone.trim()) || (email && email.trim());
        if (hasContact && !watch('portalEnabled')) {
            setValue('portalEnabled', true);
        }
    }, [watch('phone'), watch('email')]);
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
            const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;
            console.log('PatientForm: Normalized phone:', normalizedPhone);
            const patientData = {
                givenName: data.givenName || '',
                familyName: data.familyName || '',
                sex: data.sex || 'other',
                dob: data.dob || '',
                phone: normalizedPhone || undefined,
                email: data.email || undefined,
                address: data.address || '',
                state: data.state || '',
                lga: data.lga || '',
                familyId: data.familyId || '',
                photoUrl: photo || ''
            };
            const patientId = await addPatient(patientData);
            console.log('PatientForm: Patient created with ID:', patientId);
            // Automatically enroll in portal if contact info provided
            if ((normalizedPhone || data.email) && data.portalEnabled !== false) {
                const portalResult = await enrollPatientInPortal({
                    patientId,
                    givenName: data.givenName || '',
                    familyName: data.familyName || '',
                    dob: data.dob || '',
                    phone: normalizedPhone || undefined,
                    email: data.email || undefined,
                    sex: data.sex
                });
                if (!portalResult.success) {
                    console.warn('Portal enrollment failed:', portalResult.error);
                    alert(`Patient registered but portal enrollment failed: ${portalResult.error}. You can enable portal access later from patient details.`);
                }
                else {
                    console.log('Portal account created:', portalResult.portalUserId);
                    alert('Patient registered successfully! Portal access enabled. Patient can login at /patient/login');
                }
            }
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
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-6", children: [_jsx(UserIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: t('patient.register') })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col items-center space-y-4", children: [_jsxs("div", { className: "relative", children: [photo ? (_jsx("img", { src: photo, alt: "Patient", className: "w-32 h-32 rounded-full object-cover border-4 border-gray-200" })) : (_jsx("div", { className: "w-32 h-32 rounded-full bg-gray-100 flex items-center justify-center border-4 border-gray-200", children: _jsx(UserIcon, { className: "h-16 w-16 text-gray-400" }) })), photo && (_jsx("button", { type: "button", onClick: handleRemovePhoto, className: "absolute top-0 right-0 bg-red-500 text-white rounded-full p-1 m-1", children: "\u00D7" })), _jsx("button", { type: "button", onClick: () => setShowPhotoCapture(true), className: "absolute bottom-0 right-0 bg-primary text-white rounded-full p-2 cursor-pointer hover:bg-primary/90 transition-colors touch-target", children: _jsx(CameraIcon, { className: "h-5 w-5" }) })] }), _jsxs("p", { className: "text-sm text-gray-600", children: ["Tap camera to ", photo ? 'change' : 'add', " photo"] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsxs("label", { htmlFor: "givenName", className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.givenName'), " *"] }), _jsx("input", { ...register('givenName'), id: "givenName", className: "input-field", placeholder: "Enter given name", "aria-required": "true", "aria-invalid": errors.givenName ? 'true' : 'false', "aria-describedby": errors.givenName ? 'givenName-error' : undefined }), errors.givenName && (_jsx("p", { id: "givenName-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.givenName.message }))] }), _jsxs("div", { children: [_jsxs("label", { htmlFor: "familyName", className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.familyName'), " *"] }), _jsx("input", { ...register('familyName'), id: "familyName", className: "input-field", placeholder: "Enter family name", "aria-required": "true", "aria-invalid": errors.familyName ? 'true' : 'false', "aria-describedby": errors.familyName ? 'familyName-error' : undefined }), errors.familyName && (_jsx("p", { id: "familyName-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.familyName.message }))] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "sex", className: "block text-sm font-medium text-gray-700 mb-2", children: "Sex *" }), _jsxs("select", { ...register('sex'), id: "sex", className: "input-field", "aria-required": "true", "aria-invalid": errors.sex ? 'true' : 'false', "aria-describedby": errors.sex ? 'sex-error' : undefined, children: [_jsx("option", { value: "", children: "Select sex" }), _jsx("option", { value: "male", children: "Male" }), _jsx("option", { value: "female", children: "Female" }), _jsx("option", { value: "other", children: "Other" })] }), errors.sex && (_jsx("p", { id: "sex-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.sex.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "dob", className: "block text-sm font-medium text-gray-700 mb-2", children: "Date of Birth *" }), _jsx("input", { ...register('dob'), id: "dob", type: "date", className: "input-field", max: new Date().toISOString().split('T')[0], "aria-required": "true", "aria-invalid": errors.dob ? 'true' : 'false', "aria-describedby": errors.dob ? 'dob-error' : undefined }), errors.dob && (_jsx("p", { id: "dob-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.dob.message }))] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsxs("label", { htmlFor: "phone", className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.phone'), " (at least one contact required)"] }), _jsx("input", { ...register('phone'), id: "phone", type: "tel", className: "input-field", placeholder: "08012345678 or +2348012345678", "aria-invalid": errors.phone ? 'true' : 'false', "aria-describedby": errors.phone ? 'phone-error' : undefined }), errors.phone && (_jsx("p", { id: "phone-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.phone.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "email", className: "block text-sm font-medium text-gray-700 mb-2", children: "Email (at least one contact required)" }), _jsx("input", { ...register('email'), id: "email", type: "email", className: "input-field", placeholder: "patient@example.com", "aria-invalid": errors.email ? 'true' : 'false', "aria-describedby": errors.email ? 'email-error' : undefined }), errors.email && (_jsx("p", { id: "email-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.email.message }))] })] }), _jsxs("div", { children: [_jsxs("label", { htmlFor: "address", className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.address'), " *"] }), _jsx("textarea", { ...register('address'), id: "address", className: "input-field", rows: 3, placeholder: "Enter full address", "aria-required": "true", "aria-invalid": errors.address ? 'true' : 'false', "aria-describedby": errors.address ? 'address-error' : undefined }), errors.address && (_jsx("p", { id: "address-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.address.message }))] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsxs("label", { htmlFor: "state", className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.state'), " *"] }), _jsxs("select", { ...register('state', {
                                                        onChange: () => {
                                                            setValue('lga', '');
                                                        }
                                                    }), id: "state", className: "input-field", "aria-required": "true", "aria-invalid": errors.state ? 'true' : 'false', "aria-describedby": errors.state ? 'state-error' : undefined, children: [_jsx("option", { value: "", children: "Select state" }), NIGERIAN_STATES.map((state) => (_jsx("option", { value: state, children: state }, state)))] }), errors.state && (_jsx("p", { id: "state-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.state.message }))] }), _jsxs("div", { children: [_jsxs("label", { htmlFor: "lga", className: "block text-sm font-medium text-gray-700 mb-2", children: [t('patient.lga'), " *"] }), _jsxs("select", { ...register('lga'), id: "lga", className: `input-field ${!watchedState ? 'bg-gray-100 cursor-not-allowed' : ''}`, disabled: !watchedState || availableLGAs.length === 0, "aria-required": "true", "aria-invalid": errors.lga ? 'true' : 'false', "aria-describedby": errors.lga ? 'lga-error' : 'lga-hint', children: [_jsx("option", { value: "", children: !watchedState
                                                                ? 'Select state first'
                                                                : availableLGAs.length === 0
                                                                    ? 'No LGAs available for this state'
                                                                    : 'Select LGA' }), availableLGAs.map((lga) => (_jsx("option", { value: lga, children: lga }, lga)))] }), errors.lga && (_jsx("p", { id: "lga-error", role: "alert", className: "text-red-600 text-sm mt-1", children: errors.lga.message })), watchedState && availableLGAs.length > 0 && (_jsxs("p", { id: "lga-hint", className: "text-gray-500 text-xs mt-1", children: [availableLGAs.length, " LGAs available"] }))] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "familyId", className: "block text-sm font-medium text-gray-700 mb-2", children: "Family ID (Optional)" }), _jsx("input", { ...register('familyId'), id: "familyId", className: "input-field", placeholder: "Link to existing family member" })] }), _jsxs("div", { className: "border-t pt-6 mt-6", children: [_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4", children: [_jsx("h3", { className: "text-sm font-semibold text-blue-900 mb-2", children: "Patient Portal Access" }), _jsx("p", { className: "text-sm text-blue-800", children: "Enable secure online access to medical records, appointments, and test results. Patients can view their health information anytime via phone or email." })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-start", children: [_jsx("input", { ...register('portalEnabled'), type: "checkbox", id: "portalEnabled", className: "mt-1 h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary", onChange: (e) => {
                                                                // Auto-check portalEnabled if email or phone exists
                                                                const hasContact = (watch('email') || watch('phone'));
                                                                if (!hasContact && e.target.checked) {
                                                                    alert('Please provide at least an email or phone number for portal access');
                                                                    e.target.checked = false;
                                                                }
                                                            } }), _jsxs("label", { htmlFor: "portalEnabled", className: "ml-2 text-sm text-gray-700", children: [_jsx("span", { className: "font-medium", children: "Enable patient portal access" }), _jsxs("span", { className: "text-gray-600 block mt-1", children: ["Patient will receive login instructions via ", watch('email') ? 'email' : 'SMS'] })] })] }), watch('portalEnabled') && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-start ml-6", children: [_jsx("input", { ...register('termsAccepted'), type: "checkbox", id: "termsAccepted", className: "mt-1 h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary" }), _jsx("label", { htmlFor: "termsAccepted", className: "ml-2 text-sm text-gray-700", children: "I have explained portal access terms to the patient and they agree" })] }), errors.termsAccepted && (_jsx("p", { className: "text-red-600 text-sm ml-6", children: errors.termsAccepted.message })), _jsxs("div", { className: "flex items-start ml-6", children: [_jsx("input", { ...register('sendInviteNow'), type: "checkbox", id: "sendInviteNow", className: "mt-1 h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary" }), _jsxs("label", { htmlFor: "sendInviteNow", className: "ml-2 text-sm text-gray-700", children: [_jsx("span", { className: "font-medium", children: "Send portal invitation now" }), _jsx("span", { className: "text-gray-600 block mt-1", children: "Uncheck to send invitation later from patient details page" })] })] })] }))] })] }), _jsxs("div", { className: "flex space-x-4 pt-6", children: [_jsx(AudioButton, { audioKey: "action.register", fallbackText: "Register Patient", type: "submit", disabled: loading, className: "btn-primary flex-1", children: loading ? 'Registering...' : 'Register Patient' }), onCancel && (_jsx(AudioButton, { audioKey: "action.cancel", fallbackText: "Cancel", type: "button", onClick: onCancel, className: "btn-secondary flex-1", children: "Cancel" }))] })] })] }) }), showDedupeModal && dedupeData && (_jsx(PatientDedupeModal, { newPatient: dedupeData.patient, candidates: dedupeData.candidates, onResolve: handleDedupeResolve, onCancel: () => {
                    setShowDedupeModal(false);
                    setDedupeData(null);
                    setLoading(false);
                } })), showPhotoCapture && (_jsx(PhotoCapture, { onCapture: handlePhotoCapture, onCancel: () => setShowPhotoCapture(false), currentPhoto: photo || undefined }))] }));
}
