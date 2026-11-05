import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { auth } from '@clerk/nextjs/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function createClient() {
  const cookieStore = await cookies()
  const { getToken } = await auth()
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignored if called from a Server Component
          }
        },
      },
      global: {
        fetch: async (url, options = {}) => {
          let clerkToken: string | null = null;
          try {
            clerkToken = await getToken();
          } catch {
            clerkToken = null;
          }
          const headers = new Headers(options?.headers);
          
          if (clerkToken) {
            try {
              const payloadBase64 = clerkToken.split('.')[1];
              if (payloadBase64) {
                const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
                if (payload.exp && payload.exp * 1000 <= Date.now()) {
                  clerkToken = null;
                }
              }
            } catch {
            }
          }

          if (clerkToken) {
            headers.set('Authorization', `Bearer ${clerkToken}`);
          } else if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
            headers.set('Authorization', `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`);
          }
          
          return fetch(url, { ...options, headers });
        },
      },
    }
  )
}

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function resolveTenant(userId: string, sessionClaims: any) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if ((sessionClaims as any)?.tenant_id) {
    const tid = (sessionClaims as any).tenant_id as string;
    if (UUID_RE.test(tid)) return tid;
  }
  try {
    const { createClerkClient } = await import("@clerk/nextjs/server");
    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const user = await clerk.users.getUser(userId);
    if (user.publicMetadata?.tenant_id) {
      const tid = user.publicMetadata.tenant_id as string;
      if (UUID_RE.test(tid)) return tid;
    }
    const emails = (user.emailAddresses || [])
      .map((e) => e.emailAddress?.toLowerCase().trim())
      .filter(Boolean);
    if (emails.length > 0) {
      const adminClient = createAdminClient();
      const { data: tenants } = await adminClient
        .from("tenants")
        .select("id, email, access_enabled, distro_name")
        .order("created_at", { ascending: false });
      if (tenants) {
        const matched = tenants.find((t: any) =>
          t.email && emails.includes(t.email.toLowerCase().trim())
        );
        if (matched) {
          clerk.users.updateUser(userId, {
            publicMetadata: {
              ...(user.publicMetadata || {}),
              tenant_id: matched.id,
            },
          }).catch(() => {});
          return matched.id as string;
        }
      }
    }
  } catch (err) {
    console.error("resolveTenant error:", err);
  }
  return undefined;
}

export async function getTenantId() {
  const { userId, sessionClaims } = await auth();
  if (!userId) return undefined;
  return await resolveTenant(userId, sessionClaims);
}

export async function checkTenantAccess() {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return { authorized: false, reason: "not_authenticated" };
  }

  const tenantId = await resolveTenant(userId, sessionClaims);
  if (!tenantId) {
    return { authorized: false, reason: "no_tenant_assigned" };
  }

  const adminClient = createAdminClient();
  let attempts = 0;
  while (attempts < 3) {
    try {
      const { data: tenant, error } = await adminClient
        .from("tenants")
        .select("access_enabled, distro_name")
        .eq("id", tenantId)
        .single();

      if (error || !tenant) {
        return { authorized: false, reason: "tenant_not_found" };
      }

      if (!tenant.access_enabled) {
        return { authorized: false, reason: "tenant_disabled" };
      }

      return { authorized: true, tenantId, distroName: tenant.distro_name };
    } catch (err) {
      attempts++;
      if (attempts >= 3) {
        return { authorized: false, reason: "check_failed" };
      }
      await new Promise((res) => setTimeout(res, 500 * attempts));
    }
  }
  return { authorized: false, reason: "check_failed" };
}

export async function getCurrentDistroName(): Promise<string | null> {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return null;
    const supabase = await createClient();
    const { data: tenant } = await supabase
      .from('tenants')
      .select('distro_name')
      .eq('id', tenantId)
      .single();
    return tenant?.distro_name || null;
  } catch (err) {
    return null;
  }
}
