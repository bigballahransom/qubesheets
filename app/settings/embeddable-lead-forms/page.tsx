'use client';

// app/settings/embeddable-lead-forms/page.tsx
//
// Thin route wrapper. All UI + state lives in the lead-intake module so the
// feature stays self-contained.
import LeadFormSettings from '@/features/lead-intake/components/settings/LeadFormSettings';

export default function EmbeddableLeadFormsSettingsPage() {
  return <LeadFormSettings />;
}
