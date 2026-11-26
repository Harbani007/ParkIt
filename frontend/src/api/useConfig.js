// Deployment settings from GET /api/config, fetched once per page load and shared.
import { useEffect, useState } from 'react';
import { getConfig } from './parkit.js';

const DEFAULT = { email_notifications: false };
let cached = null;
let inflight = null;

export function useConfig() {
  const [config, setConfig] = useState(cached ?? DEFAULT);
  useEffect(() => {
    if (cached) return undefined;
    let live = true;
    inflight ??= getConfig()
      .then((c) => (cached = { ...DEFAULT, ...c }))
      .catch(() => DEFAULT) // optional information: never block a page on it
      .finally(() => (inflight = null));
    inflight.then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}
