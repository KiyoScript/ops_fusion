import { Role } from "@/generated/prisma/enums";
import { isOperator, type Policy } from "../types";

// ——— JO module (JOWebApp) ———
// Everyone reads the board/calendar/pickers; operators encode; MANAGER
// additionally owns the bulk tools (archive, import, deadline moves —
// legacy: Admin + Production Planner).
export const jobOrderPolicy: Policy = ({ role, can }) => {
  can("read", ["JobOrder", "JobOrderItem"]);

  if (isOperator(role)) {
    can(["create", "update", "approve"], "JobOrder");
    can(["create", "update"], "JobOrderItem");
  }
  if (role === Role.MANAGER) {
    can(["archive", "import", "move-deadline"], "JobOrder");
  }
  // "Archive" (the archived-JOs page) is deliberately NOT granted here:
  // it stays admin-only via the manage-all rule, like the legacy page.
};
