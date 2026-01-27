// Stub for @tauri-apps/api/core
// Used in development mode when not running in Tauri environment

export const invoke = () => Promise.resolve(null);
export const convertFileSrc = (filePath) => filePath;
export const transformCallback = () => () => {};
export const addPluginListener = () => ({ unsubscribe: () => {} });
export const removePluginListener = () => {};