'use client';

// lib/hooks/useLocalStoragePreference.js
//
// SSR-safe local-storage-backed useState. Renders with `defaultValue`
// server-side and on the first client render, then swaps to any stored
// value after mount so hydration stays consistent.

import { useEffect, useRef, useState } from 'react';

export function useLocalStoragePreference(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);
  const hydrated = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw));
    } catch {}
    hydrated.current = true;
  }, [key]);

  const update = (next) => {
    setValue(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };

  return [value, update];
}
