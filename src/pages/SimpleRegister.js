import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from 'react-router-dom';
import { useT } from '@/hooks/useT';
import { SimplePatientForm } from '@/components/SimplePatientForm';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
export function SimpleRegister() {
    const { t } = useT();
    const navigate = useNavigate();
    const handleSuccess = (patientId) => {
        navigate('/dashboard', {
            state: {
                message: t('patient.registrationSuccess'),
                patientId
            }
        });
    };
    const handleCancel = () => {
        navigate('/dashboard');
    };
    return (_jsx("div", { className: "min-h-screen bg-gray-50 py-8", children: _jsxs("div", { className: "max-w-4xl mx-auto px-4", children: [_jsxs("div", { className: "flex items-center space-x-4 mb-8", children: [_jsx("button", { onClick: () => navigate('/dashboard'), className: "p-3 rounded-lg hover:bg-gray-100 transition-colors touch-target-large", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: t('patient.register') }), _jsx("p", { className: "text-lg text-gray-600", children: t('simple.registerDescription') })] })] }), _jsx(SimplePatientForm, { onSuccess: handleSuccess, onCancel: handleCancel })] }) }));
}
