import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  updateProgram,
  getApiErrorMessage,
  type Program,
  type UpdateProgramPayload,
  type DegreeLevel,
  type ProgramStatus,
} from "@/lib/api/programs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertCircle, Loader2, Check } from "lucide-react";
import {
  DEGREE_LEVEL_OPTIONS,
  validateTitleAgainstDegreeLevel,
} from "./constants";

interface EditProgramDialogProps {
  program: Program;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditProgramDialog({
  program,
  open,
  onOpenChange,
  onSuccess,
}: EditProgramDialogProps) {
  const [name, setName] = useState(program.name);
  const [fullTitle, setFullTitle] = useState(program.fullTitle);
  const [degreeLevel, setDegreeLevel] = useState<DegreeLevel>(
    program.degreeLevel,
  );
  const [status, setStatus] = useState<ProgramStatus>(program.status);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (payload: UpdateProgramPayload) =>
      updateProgram(program.id, payload),
    onSuccess: () => {
      toast.success("Program updated successfully.");
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = getApiErrorMessage(err, "Failed to update program.");
      setErrorMessage(msg);
    },
  });

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = name.trim();
    const trimmedTitle = fullTitle.trim();

    if (!trimmedName) {
      setErrorMessage("Program name cannot be empty.");
      return;
    }

    if (!trimmedTitle) {
      setErrorMessage("Program full title cannot be empty.");
      return;
    }

    const keywordError = validateTitleAgainstDegreeLevel(
      trimmedTitle,
      degreeLevel,
    );
    if (keywordError) {
      setErrorMessage(keywordError);
      return;
    }

    updateMutation.mutate({
      name: trimmedName,
      fullTitle: trimmedTitle,
      degreeLevel,
      status,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-120">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight">
              Edit academic program
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Update program identity or toggle availability status.
            </DialogDescription>
          </DialogHeader>

          {errorMessage && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Cannot update program</AlertTitle>
              <AlertDescription className="text-xs">
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 py-4">
            {/* Program Name */}
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-program-name"
                className="text-xs font-semibold"
              >
                Program Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-program-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={updateMutation.isPending}
                required
              />
            </div>

            {/* Degree Level */}
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-degree-level-select"
                className="text-xs font-semibold"
              >
                Degree Level <span className="text-destructive">*</span>
              </Label>
              <Select
                value={degreeLevel}
                onValueChange={(val) => setDegreeLevel(val as DegreeLevel)}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger id="edit-degree-level-select" className="w-full">
                  <SelectValue placeholder="Select degree level" />
                </SelectTrigger>
                <SelectContent>
                  {DEGREE_LEVEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Program Full Title */}
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-program-title"
                className="text-xs font-semibold"
              >
                Full Degree Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-program-title"
                value={fullTitle}
                onChange={(e) => setFullTitle(e.target.value)}
                disabled={updateMutation.isPending}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Must contain a keyword matching degree level (e.g. "Bachelor",
                "Master", "Doctor"/"PhD", or "Associate").
              </p>
            </div>

            {/* Status Selector */}
            <div className="space-y-1.5">
              <Label
                htmlFor="edit-status-select"
                className="text-xs font-semibold"
              >
                Program Status <span className="text-destructive">*</span>
              </Label>
              <Select
                value={status}
                onValueChange={(val) => setStatus(val as ProgramStatus)}
                disabled={updateMutation.isPending}
              >
                <SelectTrigger id="edit-status-select" className="w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">
                    ACTIVE (Available for student enrollment & issuance)
                  </SelectItem>
                  <SelectItem value="INACTIVE">
                    INACTIVE (Archived / deactivated)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              className="bg-[#0f172a] hover:bg-[#1e293b] text-white gap-1.5"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Save changes</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
