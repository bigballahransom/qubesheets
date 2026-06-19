'use client';

// features/lead-intake/components/settings/LeadFormAdvanced.tsx
//
// Collapsible "Advanced settings" panel for the embeddable lead form. Holds the
// secondary controls so the top of the page stays focused on the website domain
// + the embed code:
//   - Form active toggle (when off, the link/embeds show "unavailable")
//   - Editable display name (the heading on the hosted form page)
//   - Read-only public formId
// Allowed-domains list management is deferred to Phase 4. State is owned by the
// parent (LeadFormSettings) so the page's single save bar covers every field.

interface LeadFormAdvancedProps {
  isActive: boolean;
  onActiveChange: (next: boolean) => void;
  name: string;
  onNameChange: (next: string) => void;
  formId: string;
}

export default function LeadFormAdvanced({
  isActive,
  onActiveChange,
  name,
  onNameChange,
  formId,
}: LeadFormAdvancedProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-medium text-gray-900">Form active</h3>
          <p className="text-sm text-gray-500 mt-1">
            When off, the form link and embeds show “This form is unavailable” and stop accepting
            submissions.
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => onActiveChange(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      <div className="border-t border-gray-100 pt-6">
        <label htmlFor="lead-form-name" className="block text-sm font-medium text-gray-900">
          Form name
        </label>
        <p className="mt-1 text-sm text-gray-500">
          Shown as the heading on the hosted form page. Visible to your customers.
        </p>
        <input
          id="lead-form-name"
          type="text"
          value={name}
          maxLength={200}
          onChange={(e) => onNameChange(e.target.value)}
          className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Lead Form"
        />
      </div>

      <div className="border-t border-gray-100 pt-6">
        <span className="block text-sm font-medium text-gray-900">Form ID</span>
        <p className="mt-1 text-sm text-gray-500">
          The public identifier in your embed URLs. Generated automatically and not editable.
        </p>
        <code className="mt-2 block w-full break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          {formId}
        </code>
      </div>
    </div>
  );
}
