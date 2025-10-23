import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useRef, memo } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useScrollLock, useSwipe, useHaptic } from '@/hooks/useMobile';
export const BottomSheet = memo(({ isOpen, onClose, title, children, snapPoints = [0.9, 0.5], initialSnap = 0 }) => {
    const [snapIndex, setSnapIndex] = useState(initialSnap);
    const sheetRef = useRef(null);
    const haptic = useHaptic();
    useScrollLock();
    const swipeHandlers = useSwipe(undefined, undefined, () => {
        if (snapIndex < snapPoints.length - 1) {
            setSnapIndex(snapIndex + 1);
            haptic.light();
        }
    }, () => {
        if (snapIndex > 0) {
            setSnapIndex(snapIndex - 1);
            haptic.light();
        }
        else {
            handleClose();
        }
    });
    const handleClose = () => {
        haptic.light();
        onClose();
    };
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        }
        else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);
    if (!isOpen)
        return null;
    const height = `${snapPoints[snapIndex] * 100}%`;
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 z-40 animate-fade-in", onClick: handleClose }), _jsxs("div", { ref: sheetRef, className: "fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-50 animate-slide-up", style: { height, maxHeight: '95vh' }, ...swipeHandlers, children: [_jsx("div", { className: "flex justify-center pt-3 pb-2", children: _jsx("div", { className: "w-12 h-1.5 bg-gray-300 rounded-full" }) }), _jsxs("div", { className: "flex items-center justify-between px-6 py-3 border-b border-gray-200", children: [title && (_jsx("h2", { className: "text-lg font-semibold text-gray-900", children: title })), _jsx("button", { onClick: handleClose, className: "p-2 -mr-2 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors min-h-touch-target min-w-touch-target", "aria-label": "Close", children: _jsx(XMarkIcon, { className: "h-6 w-6 text-gray-600" }) })] }), _jsx("div", { className: "overflow-y-auto px-6 py-4", style: { maxHeight: 'calc(95vh - 100px)' }, children: children })] })] }));
});
BottomSheet.displayName = 'BottomSheet';
