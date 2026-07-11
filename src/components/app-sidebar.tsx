"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  Building2,
  CalendarDays,
  ChevronsUpDown,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { signOutAction } from "@/lib/auth-actions";
import {
  defineAbilityFor,
  type AppAction,
  type AppSubject,
} from "@/lib/ability";
import type { Role } from "@/generated/prisma/enums";

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Only shown when the user's ability allows this action/subject. */
  requires?: [AppAction, AppSubject];
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Sales",
    items: [
      { title: "Quotations", href: "/quotations", icon: FileText },
      { title: "Sales Audit", href: "/sales-audit", icon: ShieldCheck },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Job Orders", href: "/job-orders", icon: ClipboardList },
      { title: "JO Calendar", href: "/job-orders/calendar", icon: CalendarDays },
      { title: "JO Reports", href: "/job-orders/reports", icon: FileText },
      // Legacy rule: the archive is admin-only
      { title: "Archive JOs", href: "/job-orders/archive", icon: Archive, requires: ["read", "Archive"] },
      { title: "Delivery Receipts", href: "/delivery-receipts", icon: Truck },
    ],
  },
  {
    label: "Masters",
    items: [
      { title: "Customers", href: "/customers", icon: Users },
      { title: "Products", href: "/products", icon: Package },
    ],
  },
  {
    label: "Maintenance",
    items: [
      // One maintenance section per system — every legacy system has its own
      // reference lists (later: PRISM, Inventory, Task Assignment, …).
      { title: "JO Maintenance", href: "/maintenance/job-orders", icon: Wrench },
      { title: "Quotation Maintenance", href: "/maintenance/quotations", icon: Wrench },
      { title: "Sales Audit Maintenance", href: "/maintenance/sales-audit", icon: Wrench },
    ],
  },
  {
    label: "System",
    items: [{ title: "Settings", href: "/settings", icon: Settings }],
  },
];

type SidebarUser = {
  name?: string | null;
  email?: string | null;
  role?: string;
};

export function AppSidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const ability = defineAbilityFor({ role: (user.role ?? "VIEWER") as Role });

  // Highlight only the most specific match (e.g. /job-orders/calendar must
  // not also light up /job-orders).
  const allHrefs = navGroups.flatMap((g) => g.items.map((i) => i.href));
  const matches = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(href + "/");
  const isActiveHref = (href: string) =>
    matches(href) &&
    !allHrefs.some((other) => other.length > href.length && matches(other));
  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">OPS Fusion</span>
                <span className="truncate text-xs text-muted-foreground">
                  Fully Unified System Integrating Operations &amp; Inventory
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items
                  .filter((item) => !item.requires || ability.can(...item.requires))
                  .map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActiveHref(item.href)}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {user.name ?? "User"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.role ?? ""}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--anchor-width)"
              >
                {/* Base UI requires GroupLabel to live inside a Group */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <div className="grid gap-0.5 text-sm">
                      <span className="font-medium">{user.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOutAction()}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
