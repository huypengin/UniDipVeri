import { Link } from "@tanstack/react-router";
import { ShieldCheck, User as UserIcon, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserProfileData } from "@/types/user";

export interface StaffHeaderProps {
  onLogout: () => Promise<void>;
  activeTab?:
    "staffs" | "programs" | "approvals" | "students" | "settings" | "account";
  user: UserProfileData | null;
}

export function StaffHeader({ onLogout, activeTab, user }: StaffHeaderProps) {
  const roles = user?.roles ?? (user?.role ? [user.role] : []);
  const isAdmin = roles.includes("ADMIN");
  const isRegistrar = roles.includes("REGISTRAR");
  const isApprover = roles.includes("APPROVER");

  // Determine institutional portal subtitle reflecting all held roles
  let subtitle = "Staff Operations";
  if (isAdmin && isRegistrar) {
    subtitle = "System Administration & Registrar Operations";
  } else if (isAdmin && isApprover) {
    subtitle = "System Administration & Approver Operations";
  } else if (isRegistrar && isApprover) {
    subtitle = "Registrar & Approvals";
  } else if (isAdmin) {
    subtitle = "System Administration";
  } else if (isRegistrar) {
    subtitle = "Registrar Operations";
  } else if (isApprover) {
    subtitle = "Approver Operations";
  }

  // Display user's name or fallback
  const displayName = user?.name?.trim() || user?.email || "Staff";

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto max-w-5xl px-6 pt-5 pb-0">
        <div className="flex items-center justify-between">
          {/* Logo and Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0f172a] text-white shadow-xs">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold leading-tight tracking-tight text-foreground">
                UniDipVeri
              </span>
              <span className="text-xs text-muted-foreground leading-tight">
                {subtitle}
              </span>
            </div>
          </div>

          {/* User info with all role pills and Sign out */}
          <div className="flex items-center gap-2.5">
            <Link
              to="/account"
              className="flex h-7 items-center gap-2 rounded-full border border-border bg-background px-3 text-xs text-muted-foreground shadow-2xs hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Manage your account"
            >
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium text-foreground">{displayName}</span>
              {/*{roles.length > 0 && (
                <div className="flex items-center gap-1">
                  {roles.map((r) => (
                    <span
                      key={r}
                      className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide ring-1 ring-border/50"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              )}*/}
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-full border-border px-3 text-xs font-medium text-foreground gap-1.5 shadow-2xs hover:bg-muted cursor-pointer"
              onClick={onLogout}
            >
              <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
              Sign out
            </Button>
          </div>
        </div>

        {/* Dynamic Navigation tabs based on user's assigned roles */}
        <nav className="flex items-center gap-6 mt-4 -mb-px">
          {isAdmin && (
            <Link
              to="/staffs"
              className={`pb-2.5 text-sm font-medium transition-colors ${
                activeTab === "staffs"
                  ? "border-b-2 border-[#0f172a] text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Staffs
            </Link>
          )}

          {isRegistrar && (
            <Link
              to="/programs"
              className={`pb-2.5 text-sm font-medium transition-colors ${
                activeTab === "programs"
                  ? "border-b-2 border-[#0f172a] text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Programs
            </Link>
          )}

          {isApprover && (
            <Link
              to="/approvals"
              className={`pb-2.5 text-sm font-medium transition-colors ${
                activeTab === "approvals"
                  ? "border-b-2 border-[#0f172a] text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Approvals
            </Link>
          )}

          {(isAdmin || isRegistrar) && (
            <span className="pb-2.5 text-sm font-medium text-muted-foreground/60 cursor-not-allowed">
              Students
            </span>
          )}

          {isAdmin && (
            <span className="pb-2.5 text-sm font-medium text-muted-foreground/60 cursor-not-allowed">
              System settings
            </span>
          )}

          <Link
            to="/account"
            className={`pb-2.5 text-sm font-medium transition-colors ${
              activeTab === "account"
                ? "border-b-2 border-[#0f172a] text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Account
          </Link>
        </nav>
      </div>
    </header>
  );
}
