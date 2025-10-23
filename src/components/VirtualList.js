import { jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect, useRef, useCallback } from 'react';
export function VirtualList({ items, itemHeight, containerHeight, renderItem, overscan = 3, className = '' }) {
    const [scrollTop, setScrollTop] = useState(0);
    const containerRef = useRef(null);
    const totalHeight = items.length * itemHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(items.length - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
    const visibleItems = items.slice(startIndex, endIndex + 1);
    const offsetY = startIndex * itemHeight;
    const handleScroll = useCallback((e) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = scrollTop;
        }
    }, [scrollTop]);
    return (_jsx("div", { ref: containerRef, onScroll: handleScroll, className: `overflow-y-auto ${className}`, style: { height: containerHeight }, children: _jsx("div", { style: { height: totalHeight, position: 'relative' }, children: _jsx("div", { style: { transform: `translateY(${offsetY}px)` }, children: visibleItems.map((item, index) => (_jsx("div", { style: { height: itemHeight }, children: renderItem(item, startIndex + index) }, startIndex + index))) }) }) }));
}
export function useVirtualScroll(items, containerHeight, itemHeight, overscan = 3) {
    const [scrollTop, setScrollTop] = useState(0);
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(items.length - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
    const visibleItems = items.slice(startIndex, endIndex + 1);
    const totalHeight = items.length * itemHeight;
    const offsetY = startIndex * itemHeight;
    return {
        visibleItems,
        totalHeight,
        offsetY,
        startIndex,
        scrollTop,
        setScrollTop
    };
}
