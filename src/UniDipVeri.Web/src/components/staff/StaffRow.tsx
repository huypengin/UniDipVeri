import { User as UserIcon, MoreHorizontal, Pencil, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { StaffMember } from "@/lib/api/staff";

interface StaffRowProps {
  staff: StaffMember;
  index: number;
  onEdit: (staff: StaffMember) => void;
  onDeactivate: (staff: StaffMember) => void;
}

export function StaffRow({ staff, index, onEdit, onDeactivate }: StaffRowProps) {
  const staffCode = `STF-${(index + 1).toString().padStart(4, "0")}`;
  const isActive = staff.status === "ACTIVE";

  const dateToFormat = staff.updatedAt || staff.createdAt;
  const formattedDate = dateToFormat
    ? new Date(dateToFormat).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const statusDetail = !isActive
    ? `Deactivated ${formattedDate ?? ""}`
    : formattedDate
      ? `Last active ${formattedDate}`
      : "Active account";

  return (
    <div className="flex items-center justify-between p-5 transition-colors hover:bg-muted/20">
      {/* Left: Avatar + Details */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-muted/30 text-muted-foreground">
          <UserIcon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          {/* Top line: Name + Status Badge + Role Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm text-foreground">
              {staff.name}
            </span>

            {/* Status Pill */}
            {isActive ? (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20 ring-inset uppercase tracking-wide">
                ACTIVE
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-400/20 ring-inset uppercase tracking-wide">
                DEACTIVATED
              </span>
            )}

            {/* Role Pills */}
            {staff.roles.map((role) => (
              <span
                key={role}
                className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-300/60 ring-inset uppercase tracking-wide"
              >
                {role}
              </span>
            ))}
          </div>

          {/* Bottom line: Email · Date */}
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{staff.email}</span>
            <span>·</span>
            <span className="shrink-0">{statusDetail}</span>
          </div>
        </div>
      </div>

      {/* Right: STF-xxxx and Actions */}
      <div className="flex items-center gap-4 shrink-0 pl-4">
        <span className="text-xs font-mono text-muted-foreground/80 tracking-wider">
          {staffCode}
        </span>

        {/* Row actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label={`Actions for ${staff.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={() => onEdit(staff)}
              className="cursor-pointer"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit staff
            </DropdownMenuItem>
            {isActive && (
              <DropdownMenuItem
                onClick={() => onDeactivate(staff)}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <UserX className="mr-2 h-4 w-4" />
                Deactivate
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
