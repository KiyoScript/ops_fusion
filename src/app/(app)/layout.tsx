import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { moduleForPath } from "@/lib/modules";
import { getEnabledModuleKeys } from "@/modules/shared/services/module-flag-service";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");

  const enabled = await getEnabledModuleKeys();

  // Route guard: a disabled module's pages bounce to the dashboard. The
  // pathname comes from a header the proxy sets, so no page has to opt in.
  const pathname = (await headers()).get("x-ops-pathname") ?? "";
  const routeModule = moduleForPath(pathname);
  if (routeModule && !enabled.has(routeModule)) redirect("/");

  return (
    <SidebarProvider>
      <AppSidebar
        user={{
          name: session.user.name,
          email: session.user.email,
          role: session.user.role,
        }}
        enabledModules={[...enabled]}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">OPS Fusion</span>
        </header>
        <main className="flex-1 space-y-6 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
