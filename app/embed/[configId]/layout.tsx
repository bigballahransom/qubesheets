// app/embed/[configId]/layout.tsx
//
// Minimal frame for the iframe lead-capture form. We're nested inside the
// root layout (ClerkProvider + various app providers), so we can't escape
// those wrappers — but we strip away any nav/sidebar chrome and present
// a clean white background suitable for hosting inside a customer's site.

export const metadata = { title: 'Get a Quote' };

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* The embed is rendered inside the customer's website. Keep the body
          transparent so the form's white card sits cleanly on whatever
          background color or hero image the host page uses behind the
          iframe. The companion <iframe> snippet sets the iframe element's
          background to transparent as well. */}
      <style>{`html, body { background: transparent !important; }`}</style>
      <div className="min-h-screen bg-transparent">{children}</div>
    </>
  );
}
