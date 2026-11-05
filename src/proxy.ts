import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/unauthorized(.*)",
  "/api/cron(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  // Log user activity for authenticated users on page visits (skip background API calls and internals)
  const { userId, sessionClaims } = await auth();
  const currentPath = request.nextUrl.pathname;
  const isInternalOrApi =
    currentPath.startsWith('/api') ||
    currentPath.startsWith('/trpc') ||
    currentPath.startsWith('/__clerk');
  
  if (userId && !isInternalOrApi) {
    try {
      const { createAdminClient } = await import('@/lib/supabase/server');
      const supabase = createAdminClient();
      
      const tenantId = (sessionClaims as any)?.tenant_id;
      const now = new Date().toISOString();

      const forwarded = request.headers.get('x-forwarded-for');
      let clientIp = '127.0.0.1';
      if (forwarded) {
        const first = forwarded.split(',')[0].trim();
        clientIp = (first === '::1' || first === '::ffff:127.0.0.1') ? '127.0.0.1' : first;
      } else {
        const realIp = request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || (request as any).ip;
        if (realIp) {
          const trimmed = realIp.trim();
          clientIp = (trimmed === '::1' || trimmed === '::ffff:127.0.0.1') ? '127.0.0.1' : trimmed;
        }
      }

      let isMdOSUser =
        (sessionClaims as any)?.app_role === 'platform_admin' ||
        (sessionClaims as any)?.email === process.env.ADMIN_EMAIL ||
        (!tenantId && currentPath.startsWith('/admin'));

      if (!isMdOSUser && !tenantId) {
        try {
          const { createClerkClient } = await import('@clerk/nextjs/server');
          const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
          const u = await clerkClient.users.getUser(userId);
          const email =
            u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ||
            u.emailAddresses[0]?.emailAddress;
          if (email && process.env.ADMIN_EMAIL && email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase()) {
            isMdOSUser = true;
          }
        } catch (_) {}
      }

      const { data: existingLog } = await supabase
        .from('admin_logs')
        .select('pk_timestamp, visited_pages')
        .eq('user_id', userId)
        .order('pk_timestamp', { ascending: false })
        .limit(1)
        .single();
      
      if (existingLog) {
        const visitedPages = existingLog.visited_pages || [];
        const updatedPages = [...visitedPages, { path: currentPath, timestamp: now }];
        
        await supabase
          .from('admin_logs')
          .update({
            visited_pages: updatedPages,
            pages_visited: updatedPages.length,
            ip_address: clientIp,
            is_mdos_user: true,
            ...(tenantId ? { tenant_id: tenantId } : {}),
          })
          .eq('pk_timestamp', existingLog.pk_timestamp);
      } else {
        await supabase.from('admin_logs').insert({
          pk_timestamp: now,
          user_id: userId,
          ip_address: clientIp,
          is_mdos_user: true,
          tenant_id: tenantId || null,
          visited_pages: [{ path: currentPath, timestamp: now }],
          pages_visited: 1,
        });
      }
    } catch (error) {
      console.error('Failed to log user activity:', error);
    }
  }
  
  return NextResponse.next();
}, { clockSkewInMs: 60000 } as any)

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    // Clerk auto-proxy path
    '/__clerk/:path*',
  ],
}
