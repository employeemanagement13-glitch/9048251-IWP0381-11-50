import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { AdminSidebar } from "@/components/layout/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!user || !adminEmail) {
    redirect("/sign-in");
  }

  const primaryEmail = user.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId
  )?.emailAddress;

  const appRole = (user.publicMetadata as any)?.app_role;
  
  if (primaryEmail !== adminEmail && appRole !== 'platform_admin') {
    redirect("/");
  }

  return (
    <div className="flex h-screen h-[100dvh] min-h-screen min-h-[100dvh] overflow-hidden bg-background">
      <AdminSidebar />
      <div className="flex flex-col flex-1 min-w-0 h-full min-h-full overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="mx-auto max-w-5xl space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

