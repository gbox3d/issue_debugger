export function logInfo(msg) {
  console.log(`[INFO] ${new Date().toISOString()} ${msg}`);
}
export function logWarn(msg) {
  console.warn(`[WARN] ${new Date().toISOString()} ${msg}`);
}
