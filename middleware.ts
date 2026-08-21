// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Create route matchers for different types of routes
const isPublicRoute = createRouteMatcher([
  '/join(.*)',
  '/video-call(.*)',
  '/call-complete(.*)',
  '/customer-upload(.*)',
  '/upload(.*)',  // Global org-level self-survey landing page
  '/vault(.*)',  // Global org-level Media Vault crew capture landing page
  '/embed(.*)',  // Embedded lead-capture form (iframe on customer websites)
  '/schedule-call(.*)',  // Hosted standalone lead scheduler — auth'd by submissionId window
  '/inventory-review(.*)',
  '/crew-review(.*)',
  '/vault-review(.*)',  // Public Media Vault share gallery (view + comments)
  '/form(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/organization-selection(.*)'
]);

const isPublicApiRoute = createRouteMatcher([
  '/api/customer-upload/(.*)',
  '/api/upload/(.*)',  // Global self-survey link API (config + create-project)
  '/api/vault/(.*)',  // Global Media Vault crew link API (match-or-create + token)
  '/api/leads/from-embed/(.*)',  // Embedded lead form submission — CORS open
  '/api/leads/form-events/(.*)',  // Embedded lead form step telemetry — CORS open, fire-and-forget
  '/api/leads/schedule-call/(.*)',  // Embedded scheduler — auth'd by submissionId window
  '/api/embedded-forms/(.+)/public',  // Public form config for iframe rendering
  '/api/self-serve/(.*)',  // Customer self-serve recording endpoints (init, start, stop, telemetry) — auth checked via uploadToken
  '/api/inventory-review/(.*)',
  '/api/crew-review/(.*)',
  '/api/vault-review/(.*)',  // Vault share gallery data + comments — auth by shareToken
  '/api/livekit/token(.*)',
  '/api/livekit/webhook(.*)',  // LiveKit webhook endpoint
  '/api/calls/(.*)',  // Lobby presence + start — customer side is anonymous, agent auth checked inside handler
  '/api/projects/(.*)/public-info',
  '/api/external/(.*)',  // External API endpoints with API key auth
  '/api/processing-complete(.*)',  // Webhook endpoint and SSE for Railway services
  '/api/generate-video-upload-url',  // Video upload pre-signed URL generation
  '/api/confirm-video-upload',  // Video upload confirmation
  '/api/test-webhook(.*)',  // Test webhook endpoint
  '/api/cron/(.*)',  // Vercel Cron endpoints — carry no Clerk session; auth enforced inside via CRON_SECRET bearer
  '/api/user/(.*)',  // User profile/settings APIs - auth checked internally
  '/api/projects/(.*)/consolidate-inventory',  // Railway call service post-processing
  '/api/projects/(.*)/finalize-inventory'  // Railway call service post-processing
]);

// Routes that require organization context
const isOrganizationRoute = createRouteMatcher([
  '/projects(.*)',
  '/customers(.*)',
  '/dashboard(.*)',
  '/calendar(.*)',
  '/dispatch(.*)',
  '/reporting(.*)',
  '/tickets(.*)',
  '/automations(.*)',
  '/api/projects(.*)',
  '/api/customers(.*)',
  '/api/inventory(.*)',
  '/api/images(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
  // Allow public routes without authentication
  if (isPublicRoute(req) || isPublicApiRoute(req)) {
    return;
  }

  await auth.protect();

  const { orgId } = await auth();

  // Personal accounts (no active org) are not supported — force organization
  // selection. API calls get a 403 so client fetches fail loudly instead of
  // following a redirect to an HTML page.
  if (isOrganizationRoute(req) && !orgId) {
    if (req.nextUrl.pathname.startsWith('/api')) {
      return Response.json(
        { error: 'An active organization is required' },
        { status: 403 }
      );
    }
    const selectionUrl = new URL('/organization-selection', req.url);
    selectionUrl.searchParams.set('redirectUrl', req.nextUrl.pathname);
    return Response.redirect(selectionUrl);
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    // Also skip the public iframe lead-form PAGE so clerkMiddleware never runs on
    // it — Clerk's dev-instance handshake redirect breaks cross-site (third-party)
    // iframe embeds when the host site is on a different origin than the app.
    // The page is fully public via /embed in isPublicRoute; the
    // /api/leads/from-embed and /api/embedded-forms/.../public routes still match
    // (they must keep running as public API routes).
    '/((?!_next|embed/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|wasm|tflite)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};