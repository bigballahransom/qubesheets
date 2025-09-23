// middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Create route matchers for different types of routes
const isPublicRoute = createRouteMatcher([
  '/video-call(.*)',
  '/call-complete(.*)', 
  '/customer-upload(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/organization-selection(.*)'
]);

const isPublicApiRoute = createRouteMatcher([
  '/api/customer-upload/(.*)',
  '/api/livekit/token(.*)',
  '/api/projects/(.*)/public-info',
  '/api/external/(.*)'  // External API endpoints with API key auth
]);

// Routes that require organization context
const isOrganizationRoute = createRouteMatcher([
  '/projects(.*)',
  '/api/projects(.*)',
  '/api/inventory(.*)',
  '/api/images(.*)'
]);

export default clerkMiddleware(async (auth, req) => {
  // Allow public routes without authentication
  if (isPublicRoute(req) || isPublicApiRoute(req)) {
    return;
  }

  // Protect all other routes - but allow personal accounts
  const { userId } = await auth.protect();

  // Get orgId separately (might be null for personal accounts)
  const { orgId } = await auth();

  // For organization-specific routes, allow both personal accounts (no orgId) 
  // and organization accounts (with orgId)
  // Only redirect if user is not in any organization AND there are organizations available
  if (isOrganizationRoute(req) && !orgId) {
    // Allow personal account usage - they will use userId in the database
    // Only redirect if we need to force organization selection
    // For now, let personal accounts work with userId-based data
    return;
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};