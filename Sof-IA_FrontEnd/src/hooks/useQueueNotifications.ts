/**
 * useQueueNotifications — public entry point.
 *
 * Implementation lives in useQueueNotificationsImpl.tsx so that JSX compiles
 * correctly (babel-preset-expo enables JSX only for .tsx files, not .ts).
 * Metro resolves .ts before .tsx, so this thin re-export keeps the import
 * path stable for callers.
 */
export { useQueueNotifications } from './useQueueNotificationsImpl';
