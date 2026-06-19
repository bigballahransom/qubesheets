'use client';

// features/lead-intake/components/LeadIntakeForm.tsx
//
// Public lead-capture form. POSTs the submission fields
// (name/email/phone/phoneType/origin/destination/moveDate/moveSize/notes) to the
// lead-intake submit endpoint, and on success swaps to the self-survey CTA using
// the returned selfSurveyUrl.
import { useState } from 'react';
import LeadSuccessCTA from './LeadSuccessCTA';

type Props = {
  formId: string;
};

type FieldValues = {
  name: string;
  email: string;
  phone: string;
  phoneType: string;
  origin: string;
  destination: string;
  moveDate: string;
  moveSize: string;
  notes: string;
};

const EMPTY: FieldValues = {
  name: '',
  email: '',
  phone: '',
  phoneType: '',
  origin: '',
  destination: '',
  moveDate: '',
  moveSize: '',
  notes: '',
};

const PHONE_TYPE_OPTIONS = ['Mobile', 'Home', 'Work', 'Other'];
const MOVE_SIZE_OPTIONS = [
  'Studio',
  '1 Bedroom',
  '2 Bedroom',
  '3 Bedroom',
  '4+ Bedroom',
  'Office',
  'Other',
];

const inputClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="mb-1 text-xs font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function LeadIntakeForm({ formId }: Props) {
  const [values, setValues] = useState<FieldValues>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [selfSurveyUrl, setSelfSurveyUrl] = useState<string | null>(null);

  function set(field: keyof FieldValues) {
    return (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => setValues((v) => ({ ...v, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setServerError(null);

    // Build a clean payload: required fields verbatim, optionals omitted if empty.
    const payload: Record<string, string> = { name: values.name, email: values.email };
    for (const key of [
      'phone',
      'phoneType',
      'origin',
      'destination',
      'moveDate',
      'moveSize',
      'notes',
    ] as const) {
      if (values[key].trim()) payload[key] = values[key];
    }

    try {
      const res = await fetch(
        `/api/public/embed/lead-forms/${encodeURIComponent(formId)}/submissions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      setSelfSurveyUrl(json.selfSurveyUrl);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (selfSurveyUrl) {
    return <LeadSuccessCTA selfSurveyUrl={selfSurveyUrl} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-lg">
        <p className="mb-5 text-sm font-medium text-slate-700">
          Fill out this form to get a free quote.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="name" label="Full name" required>
              <input
                id="name"
                type="text"
                required
                value={values.name}
                onChange={set('name')}
                className={inputClass}
                placeholder="Jane Smith"
              />
            </Field>
            <Field id="email" label="Email" required>
              <input
                id="email"
                type="email"
                required
                value={values.email}
                onChange={set('email')}
                className={inputClass}
                placeholder="jane@example.com"
              />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="phone" label="Phone">
              <input
                id="phone"
                type="tel"
                value={values.phone}
                onChange={set('phone')}
                className={inputClass}
                placeholder="+1 (555) 000-0000"
              />
            </Field>
            <Field id="phoneType" label="Phone type">
              <select
                id="phoneType"
                value={values.phoneType}
                onChange={set('phoneType')}
                className={inputClass}
              >
                <option value="">Select type</option>
                {PHONE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="moveDate" label="Move date">
              <input
                id="moveDate"
                type="date"
                value={values.moveDate}
                onChange={set('moveDate')}
                className={inputClass}
              />
            </Field>
            <Field id="moveSize" label="Move size">
              <select
                id="moveSize"
                value={values.moveSize}
                onChange={set('moveSize')}
                className={inputClass}
              >
                <option value="">Select size</option>
                {MOVE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field id="origin" label="Origin address">
            <input
              id="origin"
              type="text"
              value={values.origin}
              onChange={set('origin')}
              className={inputClass}
              placeholder="123 Main St, Springfield, IL 62701"
            />
          </Field>

          <Field id="destination" label="Destination address">
            <input
              id="destination"
              type="text"
              value={values.destination}
              onChange={set('destination')}
              className={inputClass}
              placeholder="456 Oak Ave, Chicago, IL 60601"
            />
          </Field>

          <Field id="notes" label="Notes">
            <textarea
              id="notes"
              rows={3}
              value={values.notes}
              onChange={set('notes')}
              className={`${inputClass} resize-none`}
              placeholder="Anything we should know about your move? (fragile items, heavy furniture, etc.)"
            />
          </Field>

          {serverError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {serverError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-md bg-indigo-600 px-6 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Request a quote'}
          </button>

          <p className="mt-4 text-center text-[11px] text-slate-400">Powered by QubeSheets</p>
        </form>
      </div>
    </div>
  );
}
