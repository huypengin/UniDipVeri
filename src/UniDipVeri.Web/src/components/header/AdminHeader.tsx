import { ShieldCheck, User as UserIcon, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StaffHeaderProps {
  onLogout: () => Promise<void>;
}

export function AdminHeader({ onLogout }: StaffHeaderProps) {
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
                Administration
              </span>
            </div>
          </div>

          {/* User info and Sign out */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs text-muted-foreground shadow-2xs">
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">Platform administrator</span>
            </div>
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

        {/* Navigation tabs */}
        <nav className="flex items-center gap-6 mt-4 -mb-px">
          <span className="border-b-2 border-[#0f172a] pb-2.5 text-sm font-medium text-foreground cursor-pointer">
            Staffs
          </span>
          <span className="pb-2.5 text-sm font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            Students
          </span>
          <span className="pb-2.5 text-sm font-medium text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            System settings
          </span>
        </nav>
      </div>
    </header>
  );
}
