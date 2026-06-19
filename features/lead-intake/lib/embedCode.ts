// features/lead-intake/lib/embedCode.ts
//
// Generates the two embed snippets an org copies into its website. Consumed by
// the Phase-3 settings UI; the widget's <script> src points at the form.js
// route, which injects the same hosted page in an <iframe>.

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// Direct iframe embed of the hosted form page.
export function buildIframeSnippet(formId: string, baseUrl: string): string {
  const base = trimSlash(baseUrl);
  return `<iframe src="${base}/embed/forms/lead-forms/${formId}" width="100%" height="760" style="border:none;max-width:560px;" title="Lead form"></iframe>`;
}

// JS-widget embed: a mount div + a script that injects the iframe.
export function buildWidgetSnippet(formId: string, baseUrl: string): string {
  const base = trimSlash(baseUrl);
  return [
    `<div id="qubesheets-lead-form"></div>`,
    `<script src="${base}/api/public/embed/lead-forms/form.js" data-form-id="${formId}" data-target="qubesheets-lead-form" async></script>`,
  ].join('\n');
}
