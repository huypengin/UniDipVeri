import { Link } from "@tanstack/react-router";
import { UserProfileData } from "@/context/AuthContext";
import { GraduationCap, LogOut, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StudentHeaderProps {
  onLogout: () => Promise<void>;
  activeTab?: "credentials" | "shares" | "verifications" | "account";
  user: UserProfileData | null;
}

export function StudentHeader({
  onLogout,
  activeTab = "credentials",
  user,
}: StudentHeaderProps) {
  const displayName = user?.name.trim() || user?.email || "Student";

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto max-w-5xl px-6 pt-5 pb-0">
        <div className="flex items-center justify-between">
          {/* Logo and Portal Title */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0f172a] text-white shadow-xs">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold leading-tight tracking-tight text-foreground">
                UniDipVeri
              </span>
              <span className="text-xs text-muted-foreground leading-tight">
                Student Portal
              </span>
            </div>
          </div>

          {/* User info and Sign out */}
          <div className="flex items-center gap-2.5">
            <Link
              to="/account"
              className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs text-muted-foreground shadow-2xs hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Manage your account"
            >
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{displayName}</span>
            </Link>
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-full border-border px-3 text-xs font-medium text-foreground gap-1.5 shadow-2xs hover:bg-muted"
              onClick={onLogout}
            >
              <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
              Sign out
            </Button>
          </div>
        </div>

        {/* Navigation Tabs - Matches Figure 2.3 & 3.1 */}
        <nav className="flex items-center gap-6 mt-4 -mb-px">
          <Link
            to="/credentials"
            className={`pb-2.5 text-sm font-medium transition-colors ${
              activeTab === "credentials"
                ? "border-b-2 border-[#0f172a] text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Credentials
          </Link>
          <span className="pb-2.5 text-sm font-medium text-muted-foreground/60 cursor-not-allowed">
            Share links
          </span>
          <span className="pb-2.5 text-sm font-medium text-muted-foreground/60 cursor-not-allowed">
            Verifications
          </span>
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
