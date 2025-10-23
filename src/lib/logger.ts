const DEV = import.meta.env.DEV;

export const log = (...args: unknown[]): void => {
  if (DEV) console.log(...args);
};

export const warn = (...args: unknown[]): void => {
  if (DEV) console.warn(...args);
};

export const error = (...args: unknown[]): void => {
  console.error(...args);
};

export const info = (...args: unknown[]): void => {
  if (DEV) console.info(...args);
};

export const debug = (...args: unknown[]): void => {
  if (DEV) console.debug(...args);
};

export default { log, warn, error, info, debug };
