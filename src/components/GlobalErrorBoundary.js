import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Component } from 'react';
import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
export class GlobalErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.handleRestart = () => {
            this.setState({
                hasError: false,
                error: null,
                errorInfo: null,
            });
            window.location.reload();
        };
        this.handleReset = () => {
            this.setState({
                hasError: false,
                error: null,
                errorInfo: null,
            });
        };
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }
    static getDerivedStateFromError(error) {
        return {
            hasError: true,
            error,
        };
    }
    componentDidCatch(error, errorInfo) {
        console.error('GlobalErrorBoundary caught error:', error, errorInfo);
        this.setState({
            error,
            errorInfo,
        });
        if (import.meta.env.DEV) {
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                componentStack: errorInfo.componentStack,
            });
        }
    }
    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }
            return (_jsx("div", { className: "min-h-screen flex items-center justify-center bg-gray-50 px-4", children: _jsxs("div", { className: "max-w-2xl w-full bg-white rounded-xl shadow-lg border border-gray-200 p-8", children: [_jsx("div", { className: "flex justify-center mb-6", children: _jsx("div", { className: "w-16 h-16 bg-red-100 rounded-full flex items-center justify-center", children: _jsx(ExclamationTriangleIcon, { className: "h-10 w-10 text-red-600" }) }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 text-center mb-2", children: "Something went wrong" }), _jsx("p", { className: "text-gray-600 text-center mb-8", children: "The application encountered an unexpected error. Your data is safe." }), import.meta.env.DEV && this.state.error && (_jsxs("div", { className: "mb-6 p-4 bg-red-50 border border-red-200 rounded-lg", children: [_jsx("p", { className: "text-sm font-mono text-red-900 break-words", children: this.state.error.message }), this.state.error.stack && (_jsxs("details", { className: "mt-2", children: [_jsx("summary", { className: "text-xs text-red-700 cursor-pointer hover:text-red-900", children: "Show stack trace" }), _jsx("pre", { className: "mt-2 text-xs text-red-800 overflow-x-auto whitespace-pre-wrap", children: this.state.error.stack })] }))] })), _jsxs("div", { className: "flex gap-3 justify-center", children: [_jsxs("button", { onClick: this.handleRestart, className: "flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium", children: [_jsx(ArrowPathIcon, { className: "h-5 w-5" }), "Restart Application"] }), _jsx("button", { onClick: this.handleReset, className: "px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium", children: "Try Again" })] }), _jsxs("div", { className: "mt-8 pt-6 border-t border-gray-200", children: [_jsx("p", { className: "text-sm text-gray-600 text-center", children: "If this problem persists, please contact your system administrator." }), !import.meta.env.DEV && (_jsx("p", { className: "text-xs text-gray-500 text-center mt-2", children: "Your offline data is preserved and will sync when the application restarts." }))] })] }) }));
        }
        return this.props.children;
    }
}
// Hook for programmatic error reporting (placeholder)
export function useErrorReport() {
    const reportError = (error, context) => {
        console.error('Error reported:', error, context);
        // Placeholder for future integration with Sentry, LogRocket, etc.
        // Example:
        // if (import.meta.env.VITE_SENTRY_DSN) {
        //   Sentry.captureException(error, { extra: context });
        // }
    };
    return { reportError };
}
