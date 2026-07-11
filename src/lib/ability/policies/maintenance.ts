import { Role } from "@/generated/prisma/enums";
import type { Policy } from "../types";

// ——— Maintenance (statuses / categories / employees reference lists) ———
// Everyone reads the lookup lists (dropdown pickers); only MANAGER curates
// them (ADMIN via manage-all).
export const maintenancePolicy: Policy = ({ role, can }) => {
  can("read", "Maintenance");

  if (role === Role.MANAGER) {
    can("maintain", "Maintenance");
  }
};
