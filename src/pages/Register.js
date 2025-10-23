import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from 'react-router-dom';
import { PatientForm } from '@/components/PatientForm';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
export function Register() {
    const navigate = useNavigate();
    const handleSuccess = (patientId) => {
        // Navigate to patient details or back to dashboard
        navigate('/', {
            state: {
                message: 'Patient registered successfully!',
                patientId
            }
        });
    };
    const handleCancel = () => {
        navigate('/');
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("button", { onClick: () => navigate('/'), className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Patient Registration" }), _jsx("p", { className: "text-gray-600", children: "Register a new patient for today's clinic" })] })] }), _jsx(PatientForm, { onSuccess: handleSuccess, onCancel: handleCancel })] }));
}
