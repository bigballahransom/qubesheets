// lib/client-error-reporting.ts
//
// Minimal self-hosted client crash reporting (no Sentry). Error boundaries
// and the global window listeners call reportClientError(), which POSTs to
// /api/debug/client-error where the report is written to the server logs.
//
// Hard requirement: nothing in this module may ever throw. A throwing
// reporter inside an error path re-fires window.onerror and loops.

const MAX_REPORTS_PER_PAGE_LOAD = 10;
const DEDUPE_WINDOW_MS = 30_000;

let reportCount = 0;
const recentReports = new Map<string, number>(); // dedupe key -> timestamp
let listenersInstalled = false;

export interface ClientErrorReport {
  message: string;
  stack?: string;
  componentStack?: string;
  digest?: string;
  source: string;
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined') return;
    if (reportCount >= MAX_REPORTS_PER_PAGE_LOAD) return;

    const dedupeKey = `${report.message}|${(report.stack || '').split('\n')[0]}`;
    const now = Date.now();
    const last = recentReports.get(dedupeKey);
    if (last && now - last < DEDUPE_WINDOW_MS) return;
    recentReports.set(dedupeKey, now);
    reportCount++;

    fetch('/api/debug/client-error', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...report,
        url: window.location.href,
        userAgent: navigator.userAgent,
      }),
    }).catch(() => {});
  } catch {
    // Never let the reporter itself become an error source.
  }
}

export function installGlobalErrorListeners(): void {
  try {
    if (typeof window === 'undefined' || listenersInstalled) return;
    listenersInstalled = true;

    window.addEventListener('error', (event) => {
      // event.error is null for cross-origin "Script error." events — report
      // the message alone in that case.
      reportClientError({
        message: event.message || 'Unknown window error',
        stack: event.error?.stack,
        source: 'window.onerror',
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason: any = event.reason;
      reportClientError({
        message: String(reason?.message ?? reason ?? 'Unhandled rejection'),
        stack: typeof reason?.stack === 'string' ? reason.stack : undefined,
        source: 'unhandledrejection',
      });
    });
  } catch {
    // Never throw from installation.
  }
}
