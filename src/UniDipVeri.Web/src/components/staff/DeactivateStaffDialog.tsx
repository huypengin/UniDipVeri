import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  deactivateStaff,
  getApiErrorMessage,
  type StaffMember,
} from "@/lib/api/staff";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";

interface DeactivateStaffDialogProps {
  staff: StaffMember;
  activeAdminsCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function DeactivateStaffDialog({
  staff,
  activeAdminsCount,
  open,
  onOpenChange,
  onSuccess,
}: DeactivateStaffDialogProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLastActiveAdmin =
    staff.status === "ACTIVE" &&
    staff.roles.includes("ADMIN") &&
    activeAdminsCount <= 1;

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateStaff(staff.id),
    onSuccess: () => {
      toast.success(`Account for ${staff.name} deactivated.`);
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = getApiErrorMessage(
        err,
        "Failed to deactivate staff account.",
      );
      setErrorMessage(msg);
      toast.error(msg);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold">
            Deactivate staff account?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs text-muted-foreground space-y-2">
            <span>
              Are you sure you want to deactivate <strong>{staff.name}</strong> ({staff.email})? 
              <br/>Once deactivated, this staff member will immediately
              lose access and will no longer be able to log in.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isLastActiveAdmin && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-xs font-semibold">
              Protected Administrator Account
            </AlertTitle>
            <AlertDescription className="text-xs">
              This is the only remaining active Administrator account.
              Deactivating it is blocked by security policy to avoid total system
              lockout.
            </AlertDescription>
          </Alert>
        )}

        {errorMessage && (
          <Alert variant="destructive" className="py-2.5">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-xs font-semibold">
              Action failed
            </AlertTitle>
            <AlertDescription className="text-xs">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel disabled={deactivateMutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              deactivateMutation.mutate();
            }}
            disabled={deactivateMutation.isPending}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            {deactivateMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Deactivating...
              </>
            ) : (
              "Deactivate staff"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
