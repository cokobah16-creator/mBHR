import { jsx as _jsx } from "react/jsx-runtime";
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
function AllProviders({ children }) {
    return (_jsx(BrowserRouter, { children: children }));
}
const customRender = (ui, options) => render(ui, { wrapper: AllProviders, ...options });
export * from '@testing-library/react';
export { customRender as render };
