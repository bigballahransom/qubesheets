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
  return `<iframe
  src="${origin}/embed/${configId}"
  style="width: 100%; height: 100%; min-height: 900px; min-width: 320px; border: 0; background: transparent;"
  frameborder="0"
  allowtransparency="true">
</iframe>`;
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
          className="font-mono text-xs mt-4 min-h-[160px]"
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </div>
  );
}
