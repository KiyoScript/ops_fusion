"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  FileText,
  Inbox,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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

type NavChild = {
  title: string;
  href: string;
  /** Only shown when the user's ability allows this action/subject. */
  requires?: [AppAction, AppSubject];
};

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  requires?: [AppAction, AppSubject];
  /** Indented sub-pages of this destination (no icons — quieter scan). */
  children?: NavChild[];
};

// IA: groups follow the shop's workflow — sell (Sales) → make & deliver
// (Operations) → the records both sides share (Masters) — with role-gated
// admin areas (Maintenance, System) kept at the bottom, out of daily scan.
const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Sales",
    items: [
      { title: "Inquiries", href: "/inquiries", icon: Inbox },
      { title: "Quotations", href: "/quotations", icon: FileText },
      { title: "Sales Audit", href: "/sales-audit", icon: ShieldCheck },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        title: "Job Orders",
        href: "/job-orders",
        icon: ClipboardList,
        // Sub-views of the JO board — the parent gives the context, so the
        // labels stay short (no "JO" prefix noise).
        children: [
          { title: "Calendar", href: "/job-orders/calendar" },
          { title: "Reports", href: "/job-orders/reports" },
          // Legacy rule: the archive is admin-only
          { title: "Archive", href: "/job-orders/archive", requires: ["read", "Archive"] },
        ],
      },
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
      // Gated: only roles that can actually maintain see these entries —
      // never show a door the user can't open.
      { title: "JO Maintenance", href: "/maintenance/job-orders", icon: Wrench, requires: ["maintain", "Maintenance"] },
      { title: "Quotation Maintenance", href: "/maintenance/quotations", icon: Wrench, requires: ["maintain", "Maintenance"] },
      { title: "Sales Audit Maintenance", href: "/maintenance/sales-audit", icon: Wrench, requires: ["maintain", "Maintenance"] },
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
  const allHrefs = navGroups.flatMap((g) =>
    g.items.flatMap((i) => [i.href, ...(i.children?.map((c) => c.href) ?? [])])
  );
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
        {navGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) => !item.requires || ability.can(...item.requires)
          );
          // A group with nothing the user can open never renders — no empty
          // headings, no doors that bounce.
          if (visibleItems.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => {
                    const visibleChildren = (item.children ?? []).filter(
                      (child) =>
                        !child.requires || ability.can(...child.requires)
                    );
                    // Collapsed by default; auto-opens when the user is
                    // inside one of its pages so the location stays visible.
                    const sectionActive =
                      matches(item.href) ||
                      visibleChildren.some((child) => matches(child.href));
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={isActiveHref(item.href)}
                          tooltip={item.title}
                          render={<Link href={item.href} />}
                        >
                          <item.icon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                        {visibleChildren.length > 0 && (
                          <Collapsible defaultOpen={sectionActive}>
                            <CollapsibleTrigger
                              render={
                                <SidebarMenuAction
                                  aria-label={`Toggle ${item.title} pages`}
                                  className="data-panel-open:rotate-90"
                                />
                              }
                            >
                              <ChevronRight />
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <SidebarMenuSub>
                                {visibleChildren.map((child) => (
                                  <SidebarMenuSubItem key={child.href}>
                                    <SidebarMenuSubButton
                                      isActive={isActiveHref(child.href)}
                                      render={<Link href={child.href} />}
                                    >
                                      <span>{child.title}</span>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                ))}
                              </SidebarMenuSub>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
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
