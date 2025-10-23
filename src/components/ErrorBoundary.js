import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Component } from 'react';
export class ErrorBoundary extends Component {
    constructor() {
        super(...arguments);
        this.state = {
            hasError: false
        };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (_jsx("div", { className: "min-h-screen flex items-center justify-center bg-gray-50", children: _jsx("div", { className: "max-w-md w-full bg-white rounded-lg shadow-lg p-6", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100", children: _jsx("svg", { className: "h-6 w-6 text-red-600", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", children: _jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" }) }) }), _jsx("h3", { className: "mt-4 text-lg font-medium text-gray-900", children: "Something went wrong" }), _jsx("p", { className: "mt-2 text-sm text-gray-500", children: "An unexpected error occurred. Please refresh the page and try again." }), _jsx("div", { className: "mt-6", children: _jsx("button", { onClick: () => window.location.reload(), className: "btn-primary", children: "Refresh Page" }) }), process.env.NODE_ENV === 'development' && this.state.error && (_jsxs("details", { className: "mt-4 text-left", children: [_jsx("summary", { className: "text-sm text-gray-600 cursor-pointer", children: "Error Details" }), _jsx("pre", { className: "mt-2 text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto", children: this.state.error.stack })] }))] }) }) }));
        }
        return this.props.children;
    }
}
