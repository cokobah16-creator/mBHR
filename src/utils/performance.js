const PERFORMANCE_BUDGETS = {
    page_load: 3000,
    navigation: 500,
    db_query: 100,
    sync_operation: 5000,
    photo_upload: 3000,
    api_call: 2000,
    render: 100,
    user_interaction: 100,
};
const activeMetrics = new Map();
const metricsHistory = [];
const MAX_HISTORY = 100;
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
export function startMeasure(name, metadata) {
    const id = generateId();
    const metric = {
        name,
        startTime: performance.now(),
        metadata,
    };
    activeMetrics.set(id, metric);
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(`${name}-start-${id}`);
    }
    return id;
}
export function endMeasure(id) {
    const metric = activeMetrics.get(id);
    if (!metric) {
        console.warn(`[Performance] No active metric found for id: ${id}`);
        return null;
    }
    const endTime = performance.now();
    metric.duration = endTime - metric.startTime;
    activeMetrics.delete(id);
    if (typeof performance !== 'undefined' && performance.mark) {
        performance.mark(`${metric.name}-end-${id}`);
        try {
            performance.measure(metric.name, `${metric.name}-start-${id}`, `${metric.name}-end-${id}`);
        }
        catch {
            // measure may fail in some environments
        }
    }
    metricsHistory.push(metric);
    if (metricsHistory.length > MAX_HISTORY) {
        metricsHistory.shift();
    }
    const budget = PERFORMANCE_BUDGETS[metric.name];
    if (metric.duration > budget) {
        console.warn(`[Performance] ${metric.name} exceeded budget: ${metric.duration.toFixed(2)}ms > ${budget}ms`, metric.metadata);
    }
    else if (import.meta.env.DEV) {
        console.debug(`[Performance] ${metric.name}: ${metric.duration.toFixed(2)}ms`, metric.metadata);
    }
    return metric.duration;
}
export function measureAsync(name, fn, metadata) {
    const id = startMeasure(name, metadata);
    return fn().finally(() => {
        endMeasure(id);
    });
}
export function measureSync(name, fn, metadata) {
    const id = startMeasure(name, metadata);
    try {
        return fn();
    }
    finally {
        endMeasure(id);
    }
}
export function getMetricsHistory() {
    return metricsHistory;
}
export function getMetricsSummary() {
    const summary = {};
    for (const metric of metricsHistory) {
        if (metric.duration === undefined)
            continue;
        if (!summary[metric.name]) {
            summary[metric.name] = { count: 0, total: 0, max: 0, min: Infinity };
        }
        const s = summary[metric.name];
        s.count++;
        s.total += metric.duration;
        s.max = Math.max(s.max, metric.duration);
        s.min = Math.min(s.min, metric.duration);
    }
    const result = {};
    for (const [name, s] of Object.entries(summary)) {
        result[name] = {
            count: s.count,
            avg: s.count > 0 ? s.total / s.count : 0,
            max: s.max,
            min: s.min === Infinity ? 0 : s.min,
        };
    }
    return result;
}
export function clearMetricsHistory() {
    metricsHistory.length = 0;
}
export function getWebVitals() {
    const result = {
        fcp: null,
        lcp: null,
        cls: null,
        fid: null,
        ttfb: null,
    };
    if (typeof performance === 'undefined')
        return result;
    try {
        const paintEntries = performance.getEntriesByType('paint');
        const fcpEntry = paintEntries.find(e => e.name === 'first-contentful-paint');
        if (fcpEntry) {
            result.fcp = fcpEntry.startTime;
        }
        const navEntries = performance.getEntriesByType('navigation');
        if (navEntries.length > 0) {
            result.ttfb = navEntries[0].responseStart - navEntries[0].requestStart;
        }
    }
    catch {
        // performance API may not be fully available
    }
    return result;
}
export function logPerformanceReport() {
    const summary = getMetricsSummary();
    const vitals = getWebVitals();
    console.group('[Performance Report]');
    console.log('Web Vitals:');
    console.table({
        'First Contentful Paint': vitals.fcp ? `${vitals.fcp.toFixed(2)}ms` : 'N/A',
        'Time to First Byte': vitals.ttfb ? `${vitals.ttfb.toFixed(2)}ms` : 'N/A',
    });
    console.log('Custom Metrics:');
    const tableData = {};
    for (const [name, data] of Object.entries(summary)) {
        const budget = PERFORMANCE_BUDGETS[name];
        tableData[name] = {
            Count: data.count,
            'Avg (ms)': data.avg.toFixed(2),
            'Max (ms)': data.max.toFixed(2),
            Budget: `${budget}ms`,
            Status: data.avg <= budget ? 'OK' : 'EXCEEDED',
        };
    }
    console.table(tableData);
    console.groupEnd();
}
if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__perfReport = logPerformanceReport;
}
