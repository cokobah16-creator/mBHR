const DEV = import.meta.env.DEV;
export const log = (...args) => {
    if (DEV)
        console.log(...args);
};
export const warn = (...args) => {
    if (DEV)
        console.warn(...args);
};
export const error = (...args) => {
    console.error(...args);
};
export const info = (...args) => {
    if (DEV)
        console.info(...args);
};
export const debug = (...args) => {
    if (DEV)
        console.debug(...args);
};
export default { log, warn, error, info, debug };
