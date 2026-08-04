'use client';

// components/settings/lead-forms/LiveFormPreview.tsx
//
// The editor's live preview panel: an iframe running the real embed page in
// draft-preview mode (`/embed/:id?draftPreview=1`). Every draft change is
// postMessaged into the iframe, so the admin sees the actual form — fonts,
// custom CSS, text, colors — update as they type, before saving. Screen
// pills switch between the form and the post-submit views (rendered with
// mock data inside the iframe; nothing can be submitted, booked, or sent).
//
// The iframe is essential: it isolates the form's custom CSS and Google
// Fonts from the editor page while still rendering the exact production
// components.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, RotateCcw } from 'lucide-react';
import type { LeadFormPreviewScreen } from '@/lib/leads/appearance';
import type { ILeadFormConfig, LeadFormPostSubmit } from '@/models/LeadFormConfig';

// The subset of the editor's draft state the preview needs — mirrors the
// public-config shape LeadForm consumes.
export interface LiveFormPreviewDraft {
  fields: Array<{ id: string; enabled: boolean; required: boolean; label?: string }>;
  customFields?: Array<{
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'select';
    required: boolean;
    options?: string[];
  }>;
  theme: ILeadFormConfig['theme'];
  postSubmit: LeadFormPostSubmit;
  moveSizeOptions?: string[];
  steps?: Array<{ heading?: string; fields: string[] }>;
}

export const PREVIEW_SCREENS: Array<{ id: LeadFormPreviewScreen; label: string }> = [
  { id: 'form', label: 'Form' },
  { id: 'success', label: 'Thank you' },
  { id: 'chooser', label: 'Chooser' },
  { id: 'schedule', label: 'Scheduler' },
  { id: 'error', label: 'Error' },
];

// LeadForm only understands terminal inline-message/redirect semantics on the
// client; business-hours wrapping is a server concern. Preview with the
// during-hours branch.
function resolvePostSubmitForPreview(
  ps: LeadFormPostSubmit,
): { kind: 'inline-message' | 'redirect-chooser'; message?: string } {
  const terminal = ps.kind === 'business-hours' ? ps.duringHours : ps;
  return terminal.kind === 'inline-message'
    ? { kind: 'inline-message', message: terminal.message }
    : { kind: 'redirect-chooser' };
}

interface LiveFormPreviewProps {
  configId: string;
  draft: LiveFormPreviewDraft;
  screen: LeadFormPreviewScreen;
  onScreenChange: (screen: LeadFormPreviewScreen) => void;
}

export function LiveFormPreview({
  configId,
  draft,
  screen,
  onScreenChange,
}: LiveFormPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [frameHeight, setFrameHeight] = useState(480);
  // Bumped on pill clicks; keys the form inside the iframe so re-clicking
  // "Form" after a preview submit restarts it.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === 'qs-draft-preview-ready') {
        setFrameReady(true);
      } else if (
        data?.type === 'qubesheets-form-resize' &&
        typeof data.height === 'number' &&
        data.height > 0
      ) {
        setFrameHeight(Math.min(Math.max(Math.ceil(data.height), 280), 1400));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const postDraft = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    frame.postMessage(
      {
        type: 'qs-draft-preview',
        screen,
        nonce,
        config: {
          id: configId,
          name: 'draft',
          isActive: true,
          fields: draft.fields,
          customFields: draft.customFields,
          theme: draft.theme,
          postSubmit: resolvePostSubmitForPreview(draft.postSubmit),
          moveSizeOptions: draft.moveSizeOptions,
          steps: draft.steps,
        },
      },
      window.location.origin,
    );
  }, [configId, draft, screen, nonce]);

  // Push the draft on every change, lightly debounced so fast typing doesn't
  // spam the iframe with re-renders.
  useEffect(() => {
    if (!frameReady) return;
    const handle = window.setTimeout(postDraft, 120);
    return () => window.clearTimeout(handle);
  }, [frameReady, postDraft]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <Monitor className="h-4 w-4 text-gray-400" />
          Live preview
        </div>
        {screen === 'form' && (
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            title="Reset the form (clears typed values and returns to step 1)"
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </button>
        )}
      </div>

      {/* Screen pills */}
      <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-1.5">
        {PREVIEW_SCREENS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onScreenChange(s.id);
              setNonce((n) => n + 1);
            }}
            className={
              'px-2.5 py-1 rounded-full text-xs font-medium transition-colors ' +
              (screen === s.id
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
            }
            aria-pressed={screen === s.id}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Checkerboard-ish neutral backdrop so light card backgrounds stay
          visible against something that isn't the same white. */}
      <div className="bg-gray-100/80 max-h-[70vh] overflow-y-auto">
        <iframe
          ref={iframeRef}
          src={`/embed/${configId}?draftPreview=1`}
          title="Live form preview"
          className="w-full block border-0"
          style={{ height: frameHeight }}
        />
      </div>

      <div className="px-4 py-2.5 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Interactive and unsaved-changes aware — type in the editor and watch
          it update. Submitting here only shows the thank-you screen; nothing
          is saved or sent.
        </p>
      </div>
    </div>
  );
}
