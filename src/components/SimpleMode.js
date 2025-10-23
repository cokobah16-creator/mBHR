import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useT } from '@/hooks/useT';
import { UserPlusIcon, HeartIcon, DocumentTextIcon, BeakerIcon, QueueListIcon } from '@heroicons/react/24/outline';
export function SimpleMode({ onActionSelect }) {
    const { t, speak } = useT();
    const actions = [
        {
            id: 'register',
            icon: UserPlusIcon,
            color: 'bg-blue-500 hover:bg-blue-600',
            textKey: 'action.register',
            audioKey: 'action.register'
        },
        {
            id: 'vitals',
            icon: HeartIcon,
            color: 'bg-green-500 hover:bg-green-600',
            textKey: 'action.vitals',
            audioKey: 'action.vitals'
        },
        {
            id: 'consult',
            icon: DocumentTextIcon,
            color: 'bg-purple-500 hover:bg-purple-600',
            textKey: 'action.consult',
            audioKey: 'action.consult'
        },
        {
            id: 'pharmacy',
            icon: BeakerIcon,
            color: 'bg-orange-500 hover:bg-orange-600',
            textKey: 'action.pharmacy',
            audioKey: 'action.pharmacy'
        },
        {
            id: 'queue',
            icon: QueueListIcon,
            color: 'bg-indigo-500 hover:bg-indigo-600',
            textKey: 'action.queue',
            audioKey: 'action.queue'
        }
    ];
    const handleActionClick = async (action) => {
        // Play audio prompt
        try {
            await speak(action.audioKey);
        }
        catch (error) {
            console.warn('Audio playback failed:', error);
        }
        onActionSelect(action.id);
    };
    return (_jsxs("div", { className: "max-w-4xl mx-auto p-6", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-2", children: t('app.title') }), _jsx("p", { className: "text-lg text-gray-600", children: t('simple.chooseAction') })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", children: actions.map((action) => (_jsxs("button", { onClick: () => handleActionClick(action), className: `${action.color} text-white rounded-2xl p-8 text-center transition-all hover:scale-105 transform group touch-target-large shadow-lg`, children: [_jsx(action.icon, { className: "h-16 w-16 mx-auto mb-4 group-hover:scale-110 transition-transform" }), _jsx("div", { className: "text-xl font-bold mb-2", children: t(action.textKey) }), _jsx("div", { className: "text-sm opacity-90", children: t(`${action.textKey}.description`) })] }, action.id))) }), _jsx("div", { className: "mt-8 text-center", children: _jsx("p", { className: "text-sm text-gray-500", children: t('simple.tapToHear') }) })] }));
}
