import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createProgram,
  getApiErrorMessage,
  type CreateProgramPayload,
  type DegreeLevel,
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
import { AlertCircle, Loader2, Plus } from "lucide-react";
import {
  DEGREE_LEVEL_OPTIONS,
  validateTitleAgainstDegreeLevel,
} from "./constants";

interface CreateProgramDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateProgramDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateProgramDialogProps) {
  const [name, setName] = useState("");
  const [fullTitle, setFullTitle] = useState("");
  const [degreeLevel, setDegreeLevel] = useState<DegreeLevel>("BACHELOR");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setFullTitle("");
    setDegreeLevel("BACHELOR");
    setErrorMessage(null);
  };

  const createMutation = useMutation({
    mutationFn: (payload: CreateProgramPayload) => createProgram(payload),
    onSuccess: () => {
      toast.success("Program created successfully.");
      onSuccess();
      onOpenChange(false);
      resetForm();
    },
    onError: (err) => {
      const msg = getApiErrorMessage(err, "Failed to create program.");
      setErrorMessage(msg);
    },
  });

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = name.trim();
    const trimmedTitle = fullTitle.trim();

    if (!trimmedName) {
      setErrorMessage("Program name is required.");
      return;
    }

    if (!trimmedTitle) {
      setErrorMessage("Program full title is required.");
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

    createMutation.mutate({
      name: trimmedName,
      fullTitle: trimmedTitle,
      degreeLevel,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetForm();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-120">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold tracking-tight">
              Create academic program
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Define a new academic curriculum. Programs organize student
              cohorts and their issued verifiable credentials.
            </DialogDescription>
          </DialogHeader>

          {errorMessage && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Cannot create program</AlertTitle>
              <AlertDescription className="text-xs">
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 py-4">
            {/* Program Name */}
            <div className="space-y-1.5">
              <Label htmlFor="program-name" className="text-xs font-semibold">
                Program Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="program-name"
                placeholder="e.g. Data Science"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={createMutation.isPending}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Short conversational name used in cohort lists and dashboards.
              </p>
            </div>

            {/* Degree Level */}
            <div className="space-y-1.5">
              <Label
                htmlFor="degree-level-select"
                className="text-xs font-semibold"
              >
                Degree Level <span className="text-destructive">*</span>
              </Label>
              <Select
                value={degreeLevel}
                onValueChange={(val) => setDegreeLevel(val as DegreeLevel)}
                disabled={createMutation.isPending}
              >
                <SelectTrigger id="degree-level-select" className="w-full">
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
              <Label htmlFor="program-title" className="text-xs font-semibold">
                Full Degree Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="program-title"
                placeholder="e.g. Bachelor of Science in Data Science"
                value={fullTitle}
                onChange={(e) => setFullTitle(e.target.value)}
                disabled={createMutation.isPending}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Official title printed on graduation credentials. Must contain a
                keyword matching the degree level (e.g. "Bachelor", "Master",
                "Doctor"/"PhD", or "Associate").
              </p>
            </div>
          </div>

          <DialogFooter className="mt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-[#0f172a] hover:bg-[#1e293b] text-white gap-1.5"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  <span>Create program</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
