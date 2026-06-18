'use client';

// components/settings/lead-forms/tabs/JavaScriptPluginTab.tsx
//
// Generates the bring-your-own-form snippet so movers can keep their
// existing website form and just intercept its submissions. The plugin
// itself lives at /public/qs-embed.js. The snippet declares which fields
// on the mover's form map to which lead fields on our side.

import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface JavaScriptPluginTabProps {
  configId: string;
}

function buildSnippet(origin: string, configId: string): string {
  return `<!-- STEP 1: Configure the plugin. Update formSelector to point at
              your existing website form, and adjust the mapping so each
              key matches the id or [name] attribute of the corresponding
              field on your form. -->
<script>
  window.QubeSheets = {
    config:       { configId: ${JSON.stringify(configId)} },
    formSelector: '#quote-form',

    mapping: {
      'first-name':       { target: 'firstName',   required: true  },
      'last-name':        { target: 'lastName',    required: true  },
      'email':            { target: 'email',       required: true  },
      'phone':            { target: 'phone',       required: true  },
      // 'phone-type':    { target: 'phoneType',   required: false },
      'move-date':        { target: 'moveDate',    required: false },
      // 'move-size':     { target: 'moveSize',    required: false },
      'origin-full':      { target: 'origin',      required: false },
      'destination-full': { target: 'destination', required: false },
      // 'company-name':  { target: 'companyName', required: false },
    },

    // Optional: override the default behavior (redirect to inventory
    // capture, or replace the form with a thank-you message).
    // onSuccess: function (response) { /* response.action.uploadUrl, ... */ },
    // onError:   function (err)      { /* show a custom error UI */ },
  };
</script>

<!-- STEP 2: Load the plugin. Place this BEFORE the closing </body> tag. -->
<script src="${origin}/qs-embed.js" defer></script>`;
}

export function JavaScriptPluginTab({ configId }: JavaScriptPluginTabProps) {
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
      toast.success('JavaScript plugin code copied to clipboard.');
    } catch (error) {
      console.error('Failed to copy plugin snippet:', error);
      toast.error('Could not copy to clipboard.');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-gray-900">JavaScript Plugin</h2>
            <p className="text-sm text-gray-500 mt-1">
              Already have a contact form on your website? Use this plugin to
              capture leads from your existing form without changing its look
              or layout. Paste the markup below into the footer of your site,
              just before the closing <code className="px-1 py-0.5 bg-gray-100 rounded">&lt;/body&gt;</code> tag.
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
          className="font-mono text-xs mt-4 min-h-[420px]"
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="mt-4 space-y-2 text-xs text-gray-500">
          <p>
            <strong className="text-gray-700">formSelector</strong> &mdash; any
            CSS selector compatible with <code className="px-1 bg-gray-100 rounded">document.querySelector</code>.
            Examples: <code className="px-1 bg-gray-100 rounded">#quote-form</code>,
            <code className="px-1 bg-gray-100 rounded">.contact .lead-form</code>.
          </p>
          <p>
            <strong className="text-gray-700">mapping</strong> &mdash; each key
            is the <code className="px-1 bg-gray-100 rounded">id</code> or
            <code className="px-1 bg-gray-100 rounded">name</code> of an input on
            your form. The <code className="px-1 bg-gray-100 rounded">target</code> is
            the Qube Sheets field it should populate.
          </p>
          <p>
            The plugin fires <code className="px-1 bg-gray-100 rounded">qs:lead-submitted</code> and
            <code className="px-1 bg-gray-100 rounded">qs:lead-error</code> CustomEvents on
            <code className="px-1 bg-gray-100 rounded">window</code> so you can
            hook your own analytics or UI.
          </p>
        </div>
      </div>
    </div>
  );
}
