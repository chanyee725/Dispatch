// Browser notification switch (ported from standalone Dispatch, #624). The only thing stored is the on/off boolean,
// in this browser.
import { useSyncExternalStore } from 'react';

const KEY = 'drawing:alerts';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

export type AlertStatus = 'unsupported' | 'denied' | 'off' | 'on';

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

function read(): AlertStatus {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && localStorage.getItem(KEY) === '1' ? 'on' : 'off';
}

export function useAlertStatus() {
  return useSyncExternalStore(f => { listeners.add(f); return () => listeners.delete(f); }, read, () => 'unsupported' as AlertStatus);
}

export const alertsOn = () => read() === 'on';

/** Asks for permission only from an explicit click. A refusal leaves alerts off. */
export async function turnAlertsOn() {
  if (!notifySupported()) return emit();
  const p = Notification.permission === 'default' ? await Notification.requestPermission().catch(() => 'denied' as const) : Notification.permission;
  if (p === 'granted') localStorage.setItem(KEY, '1');
  emit();
}

export function turnAlertsOff() {
  localStorage.setItem(KEY, '0');
  emit();
}
