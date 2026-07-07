import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <ModulePlaceholder
      title="Settings"
      description="Users, roles, booklet maintenance, and system configuration."
      phase="Phase 1+"
    />
  );
}
