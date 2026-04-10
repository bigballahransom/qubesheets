'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useEgressHealthMonitor - Monitors LiveKit egress health in real-time
 *
 * This hook periodically checks the recording status and triggers
 * the backup recording when the primary egress fails or becomes unhealthy.
 *
 * Features:
 * - Periodic health checks via API
 * - Detection of stuck recordings (stuck in 'starting')
 * - Automatic callback when egress fails
 * - Consecutive failure threshold for reliability
 */

export type EgressHealthStatus = 'unknown' | 'healthy' | 'warning' | 'failed';

export interface EgressHealth {
  status: EgressHealthStatus;
  lastCheck: Date | null;
  consecutiveFailures: number;
  recordingStatus: string | null;
  error: string | null;
}

export interface UseEgressHealthMonitorOptions {
  recordingId: string | null;
  onEgressFailed: () => void;
  checkInterval?: number;     // Default: 30000 (30s)
  warningThreshold?: number;  // Time in 'starting' before warning (default: 60000ms)
  failureThreshold?: number;  // Consecutive API failures before triggering backup (default: 2)
  enabled?: boolean;
}

export interface UseEgressHealthMonitorReturn {
  health: EgressHealth;
  checkHealth: () => Promise<void>;
  reset: () => void;
}

export function useEgressHealthMonitor({
  recordingId,
  onEgressFailed,
  checkInterval = 30000,
  warningThreshold = 60000,
  failureThreshold = 2,
  enabled = true,
}: UseEgressHealthMonitorOptions): UseEgressHealthMonitorReturn {
  const [health, setHealth] = useState<EgressHealth>({
    status: 'unknown',
    lastCheck: null,
    consecutiveFailures: 0,
    recordingStatus: null,
    error: null,
  });

  const consecutiveFailuresRef = useRef(0);
  const recordingStartTimeRef = useRef<Date | null>(null);
  const failureTriggeredRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset tracking state
  const reset = useCallback(() => {
    consecutiveFailuresRef.current = 0;
    recordingStartTimeRef.current = null;
    failureTriggeredRef.current = false;
    setHealth({
      status: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      recordingStatus: null,
      error: null,
    });
  }, []);

  // Health check function
  const checkHealth = useCallback(async () => {
    if (!recordingId || !enabled || failureTriggeredRef.current) return;

    try {
      const res = await fetch(`/api/video-recordings/${recordingId}/status`);

      if (!res.ok) {
        throw new Error(`Status check failed: ${res.status}`);
      }

      const data = await res.json();
      const { status, error, startedAt } = data;

      // Track when recording started
      if (startedAt && !recordingStartTimeRef.current) {
        recordingStartTimeRef.current = new Date(startedAt);
      }

      // Check for explicit failure status
      if (status === 'failed') {
        console.error('[Health Monitor] Egress recording failed:', error);
        failureTriggeredRef.current = true;
        onEgressFailed();
        setHealth({
          status: 'failed',
          lastCheck: new Date(),
          consecutiveFailures: consecutiveFailuresRef.current + 1,
          recordingStatus: status,
          error: error || 'Recording failed',
        });
        return;
      }

      // Check for partial status (egress disconnected)
      if (status === 'partial') {
        console.warn('[Health Monitor] Recording is partial - egress may have disconnected');
        // Don't trigger backup immediately - auto-restart may handle it
        setHealth({
          status: 'warning',
          lastCheck: new Date(),
          consecutiveFailures: 0,
          recordingStatus: status,
          error: 'Recording is partial',
        });
        return;
      }

      // Check for stuck in 'starting' state
      if (status === 'starting' && recordingStartTimeRef.current) {
        const elapsed = Date.now() - recordingStartTimeRef.current.getTime();

        if (elapsed > warningThreshold * 2) {
          // 2x threshold = treat as failed
          console.error('[Health Monitor] Egress stuck in starting state for too long');
          failureTriggeredRef.current = true;
          onEgressFailed();
          setHealth({
            status: 'failed',
            lastCheck: new Date(),
            consecutiveFailures: consecutiveFailuresRef.current + 1,
            recordingStatus: status,
            error: 'Recording stuck in starting state',
          });
          return;
        }

        if (elapsed > warningThreshold) {
          console.warn('[Health Monitor] Egress stuck in starting state');
          setHealth({
            status: 'warning',
            lastCheck: new Date(),
            consecutiveFailures: consecutiveFailuresRef.current,
            recordingStatus: status,
            error: null,
          });
          return;
        }
      }

      // Healthy
      consecutiveFailuresRef.current = 0;
      setHealth({
        status: 'healthy',
        lastCheck: new Date(),
        consecutiveFailures: 0,
        recordingStatus: status,
        error: null,
      });

    } catch (error) {
      consecutiveFailuresRef.current++;

      console.warn(
        `[Health Monitor] Check failed (${consecutiveFailuresRef.current}/${failureThreshold}):`,
        error
      );

      if (consecutiveFailuresRef.current >= failureThreshold) {
        console.error('[Health Monitor] Multiple consecutive failures - activating backup');
        failureTriggeredRef.current = true;
        onEgressFailed();
        setHealth({
          status: 'failed',
          lastCheck: new Date(),
          consecutiveFailures: consecutiveFailuresRef.current,
          recordingStatus: null,
          error: error instanceof Error ? error.message : 'Health check failed',
        });
      } else {
        setHealth({
          status: 'warning',
          lastCheck: new Date(),
          consecutiveFailures: consecutiveFailuresRef.current,
          recordingStatus: null,
          error: error instanceof Error ? error.message : 'Health check failed',
        });
      }
    }
  }, [recordingId, enabled, onEgressFailed, warningThreshold, failureThreshold]);

  // Start periodic health checks
  useEffect(() => {
    if (!recordingId || !enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial check after a short delay (give egress time to start)
    const initialTimeout = setTimeout(() => {
      checkHealth();
    }, 5000);

    // Periodic checks
    intervalRef.current = setInterval(checkHealth, checkInterval);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [recordingId, enabled, checkHealth, checkInterval]);

  // Reset when recordingId changes
  useEffect(() => {
    reset();
  }, [recordingId, reset]);

  return {
    health,
    checkHealth,
    reset,
  };
}
