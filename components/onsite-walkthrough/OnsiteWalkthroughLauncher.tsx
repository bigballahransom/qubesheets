'use client';

// components/onsite-walkthrough/OnsiteWalkthroughLauncher.tsx
// Modal launched from the Actions menu. On open, mints a token via
// /api/projects/[projectId]/onsite-walkthrough/create and displays a QR code
// the mover scans on their phone/tablet.
import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import OnsiteWalkthroughQRView from './OnsiteWalkthroughQRView';

interface OnsiteWalkthroughLauncherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName?: string;
}

interface SessionData {
  uploadToken: string;
  mobileUrl: string;
  liveKitRoomName: string;
}

export default function OnsiteWalkthroughLauncher({
  open,
  onOpenChange,
  projectId,
  projectName,
}: OnsiteWalkthroughLauncherProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSession() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setSession(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/onsite-walkthrough/create`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to create session');
      }
      setSession({
        uploadToken: data.uploadToken,
        mobileUrl: data.mobileUrl,
        liveKitRoomName: data.liveKitRoomName,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create session';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Mint a new session every time the modal opens.
  useEffect(() => {
    if (open) {
      createSession();
    } else {
      setSession(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Onsite Walkthrough</DialogTitle>
          <DialogDescription>
            {projectName
              ? `Start a mover-controlled walkthrough for ${projectName}.`
              : 'Start a mover-controlled walkthrough.'}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Generating session…</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertCircle className="h-6 w-6 text-red-500" />
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" onClick={createSession}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {session && !loading && !error && (
          <OnsiteWalkthroughQRView
            mobileUrl={session.mobileUrl}
            liveKitRoomName={session.liveKitRoomName}
            uploadToken={session.uploadToken}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
