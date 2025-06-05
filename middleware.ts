// middleware.ts
import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  
  // Define public routes that don't require authentication
  const publicRoutes = [
    '/video-call', // Video call pages for customers
    '/call-complete', // Call completion page
    '/customer-upload', // Customer upload pages
    '/sign-in',
    '/sign-up',
  ];

  // Check if the current path matches any public route
  const isPublicRoute = publicRoutes.some(route => {
    return pathname.startsWith(route);
  });

  // Check for specific API routes that should be public
  const isPublicApiRoute = 
    pathname.startsWith('/api/customer-upload/') ||
    pathname.startsWith('/api/livekit/token') ||
    /^\/api\/projects\/[^/]+\/public-info/.test(pathname); // Public project info API

  // Only protect routes that are not public
  if (!isPublicRoute && !isPublicApiRoute) {
    await auth.protect();
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