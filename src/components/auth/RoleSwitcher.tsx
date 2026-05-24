import { useAuth, ROLE_LABELS, resolveDisplayRole } from "@/contexts/AuthContext";
import { Shield } from "lucide-react";

export function RoleSwitcher() {
  const { user } = useAuth();
  if (!user) return null;

  const displayRole = resolveDisplayRole(user);
  if (!displayRole) return null;

  return (
    <div className="flex items-center gap-2">
      <Shield className="w-4 h-4 text-muted-foreground" />
      <span className="h-8 min-w-[140px] px-2 flex items-center rounded-md border border-border bg-muted/50 text-xs text-foreground">
        {ROLE_LABELS[displayRole]}
      </span>
    </div>
  );
}
