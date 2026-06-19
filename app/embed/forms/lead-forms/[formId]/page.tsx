// app/embed/forms/lead-forms/[formId]/page.tsx
//
// PUBLIC hosted lead-form page (iframe target + widget target). Thin server
// wrapper: resolve the form by its public id, gate on isActive, render the
// client form. Public via middleware (Phase 1).
import { getFormByPublicId } from '@/features/lead-intake/lib/leadForms';
import LeadIntakeForm from '@/features/lead-intake/components/LeadIntakeForm';

export const dynamic = 'force-dynamic';

function Unavailable() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 text-center">
      <h1 className="text-lg font-semibold text-slate-900">This form is unavailable</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-600">
        The form you&apos;re looking for doesn&apos;t exist or is no longer accepting submissions.
      </p>
    </div>
  );
}

export default async function LeadFormPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  const form = await getFormByPublicId(formId);

  if (!form || !form.isActive) {
    return <Unavailable />;
  }

  return <LeadIntakeForm formId={form.formId} />;
}
