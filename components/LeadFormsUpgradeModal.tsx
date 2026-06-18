'use client';

// components/LeadFormsUpgradeModal.tsx
//
// Shown when a mover without the `"leadForm"` add-on tries to enter the
// Lead Forms settings. Sends a notification SMS to the QS support
// numbers when the mover clicks "Contact Support". Self-contained — owns
// its own state for the in-flight request and the success toast.

import { useState } from 'react';
import { Loader2, MailQuestion, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface LeadFormsUpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type RequestState = 'idle' | 'sending' | 'sent';

export default function LeadFormsUpgradeModal({
  open,
  onOpenChange,
}: LeadFormsUpgradeModalProps) {
  const [state, setState] = useState<RequestState>('idle');

  const contact = async () => {
    if (state === 'sending') return;
    setState('sending');
    try {
      const res = await fetch('/api/lead-forms/contact-support', {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(
          (data && typeof data.error === 'string' && data.error) ||
            'Could not send the request',
        );
      }
      setState('sent');
      toast.success('Support has been notified. We will be in touch shortly.');
    } catch (err) {
      console.error('[LeadFormsUpgradeModal] contact failed', err);
      setState('idle');
      toast.error(
        err instanceof Error
          ? err.message
          : 'Could not send the request — please try again.',
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          // Reset for next open.
          setTimeout(() => setState('idle'), 150);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-3">
            <MailQuestion className="w-6 h-6 text-amber-700" />
          </div>
          <DialogTitle>You need credits to use Lead Forms</DialogTitle>
          <DialogDescription>
            Lead Forms is a paid add-on. Reach out to our team to add it to
            your subscription — we&apos;ll text you back within the day.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={state === 'sending'}
          >
            Close
          </Button>
          <Button
            onClick={contact}
            disabled={state !== 'idle'}
            className="sm:ml-auto"
          >
            {state === 'sending' ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Notifying support…
              </>
            ) : state === 'sent' ? (
              <>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Sent
              </>
            ) : (
              'Contact Support'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
