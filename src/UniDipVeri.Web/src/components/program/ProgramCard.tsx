import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Program } from "@/lib/api/programs";
import { getDegreeLevelLabel } from "./constants";

interface ProgramCardProps {
  program: Program;
  onEdit: (program: Program) => void;
}

export function ProgramCard({ program, onEdit }: ProgramCardProps) {
  const isActive = program.status === "ACTIVE";

  return (
    <div className="flex items-center justify-between p-5 transition-colors hover:bg-muted/20">
      {/* Left Details */}
      <div className="min-w-0 flex-1 space-y-1">
        {/* Name and Status */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm sm:text-base text-foreground">
            {program.name}
          </span>

          {isActive ? (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20 ring-inset uppercase tracking-wide">
              ACTIVE
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-400/20 ring-inset uppercase tracking-wide">
              INACTIVE
            </span>
          )}
        </div>

        {/* Full Title & Degree Level */}
        <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">
          <span>{program.fullTitle}</span>
          <span>·</span>
          <span className="font-medium text-foreground/80">
            {getDegreeLevelLabel(program.degreeLevel)}
          </span>
        </div>

        {/* Rules line matching mockup */}
        <div className="text-xs text-muted-foreground/70 flex items-center gap-1">
          <span>Rules: Standard curriculum</span>
        </div>
      </div>

      {/* Right Action */}
      <div className="shrink-0 pl-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(program)}
          className="h-8 rounded-lg border-border px-3 text-xs font-medium text-foreground gap-1.5 shadow-2xs hover:bg-muted cursor-pointer"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          Edit
        </Button>
      </div>
    </div>
  );
}
