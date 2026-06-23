'use client';

// components/settings/lead-forms/tabs/EmbedCodeTab.tsx
//
// Renders the iframe embed snippet using the current host so dev environments
// produce a working snippet.

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface EmbedCodeTabProps {
  configId: string;
}

function buildSnippet(origin: string, configId: string): string {
  // The snippet ships TWO things:
  //   1. An <iframe> with a small initial min-height so something is visible
  //      while the form's bundle is loading.
  //   2. A tiny inline <script> that listens for the form's
  //      `qubesheets-form-resize` postMessages and sets the iframe height
  //      to the reported content size. This is what makes the iframe
  //      "shrink to fit" the form (and grow when the wizard advances).
  const iframeId = `qs-leadform-${configId}`;
  return `<iframe
  id="${iframeId}"
  src="${origin}/embed/${configId}"
  style="width: 100%; min-height: 200px; min-width: 320px; border: 0; background: transparent; display: block;"
  frameborder="0"
  allowtransparency="true"
></iframe>
<script>
(function () {
  var iframe = document.getElementById(${JSON.stringify(iframeId)});
  if (!iframe) return;
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'qubesheets-form-resize') return;
    if (e.source !== iframe.contentWindow) return;
    iframe.style.height = e.data.height + 'px';
  });
})();
</script>`;
}

export function EmbedCodeTab({ configId }: EmbedCodeTabProps) {
  // SSR-safe origin fallback. window only exists on the client; the snippet
  // re-renders with the real host once we hydrate.
  const [origin, setOrigin] = useState('https://app.qubesheets.com');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  const snippet = buildSnippet(origin, configId);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success('Embed code copied to clipboard.');
    } catch (error) {
      console.error('Failed to copy embed code:', error);
      toast.error('Could not copy to clipboard.');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-gray-900">Embed code</h2>
            <p className="text-sm text-gray-500 mt-1">
              Paste this into your website&apos;s HTML where you want the form
              to appear.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={copy}>
            <Copy className="mr-1.5 h-4 w-4" />
            Copy
          </Button>
        </div>
        <Textarea
          readOnly
          value={snippet}
          className="font-mono text-xs mt-4 min-h-[280px]"
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </div>
  );
}
