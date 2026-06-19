// app/api/public/embed/lead-forms/form.js/route.ts
//
// PUBLIC JS-widget script. An org drops:
//   <div id="qubesheets-lead-form"></div>
//   <script src="<base>/api/public/embed/lead-forms/form.js"
//           data-form-id="<formId>" data-target="qubesheets-lead-form" async></script>
// This serves a tiny IIFE that injects an <iframe> pointing at the hosted form
// page — so the embedded form inherits all of the React page's logic/styling.
// Public via the Phase-1 `/api/public/embed/lead-forms/(.*)` matcher.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const WIDGET_SCRIPT = `(function () {
  var s = document.currentScript;
  if (!s) return;
  var formId = s.getAttribute('data-form-id');
  if (!formId) return;
  var targetId = s.getAttribute('data-target');
  var origin;
  try { origin = new URL(s.src).origin; } catch (e) { return; }

  var iframe = document.createElement('iframe');
  iframe.src = origin + '/embed/forms/lead-forms/' + encodeURIComponent(formId);
  iframe.title = 'Lead form';
  iframe.loading = 'lazy';
  iframe.style.border = 'none';
  iframe.style.width = '100%';
  iframe.style.maxWidth = '560px';
  iframe.style.height = '760px';

  var mount = targetId ? document.getElementById(targetId) : null;
  if (mount) {
    mount.appendChild(iframe);
  } else if (s.parentNode) {
    s.parentNode.insertBefore(iframe, s);
  }
})();
`;

export async function GET() {
  return new NextResponse(WIDGET_SCRIPT, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    },
  });
}
