import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  updateStaff,
  getApiErrorMessage,
  type StaffMember,
  type UpdateStaffPayload,
} from "@/lib/api/staff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { AlertCircle, Loader2 } from "lucide-react";
import { AVAILABLE_ROLES } from "./constants";

interface EditStaffDialogProps {
  staff: StaffMember;
  activeAdminsCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditStaffDialog({
  staff,
  activeAdminsCount,
  open,
  onOpenChange,
  onSuccess,
}: EditStaffDialogProps) {
  const [name, setName] = useState(staff.name);
  const [email, setEmail] = useState(staff.email);
  const [selectedRoles, setSelectedRoles] = useState<string[]>(staff.roles);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const editMutation = useMutation({
    mutationFn: (payload: UpdateStaffPayload) => updateStaff(staff.id, payload),
    onSuccess: () => {
      toast.success("Staff account updated successfully.");
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = getApiErrorMessage(err, "Failed to update staff account.");
      setErrorMessage(msg);
      toast.error(msg);
    },
  });

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const isCurrentActiveAdmin =
    staff.status === "ACTIVE" && staff.roles.includes("ADMIN");
  const isRemovingAdminRole =
    isCurrentActiveAdmin && !selectedRoles.includes("ADMIN");
  const isLastAdminRoleRemovalRisk =
    isRemovingAdminRole && activeAdminsCount <= 1;

  const hasRegistrarAndApprover =
    selectedRoles.includes("REGISTRAR") && selectedRoles.includes("APPROVER");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage("Name cannot be empty.");
      return;
    }
    if (!email.trim()) {
      setErrorMessage("Email cannot be empty.");
      return;
    }
    if (selectedRoles.length === 0) {
      setErrorMessage("At least one role must be assigned.");
      return;
    }

    editMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      roles: selectedRoles,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Edit staff account
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Update profile information and role assignments for {staff.name}.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 pt-2"
          autoComplete="off"
        >
          {errorMessage && (
            <Alert variant="destructive" className="py-2.5">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="text-xs font-semibold">Error</AlertTitle>
              <AlertDescription className="text-xs">
                {errorMessage}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-name" className="text-xs font-medium">
              Full name
            </Label>
            <Input
              id="edit-staff-name"
              name="edit-staff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={editMutation.isPending}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-staff-email" className="text-xs font-medium">
              Staff email
            </Label>
            <Input
              id="edit-staff-email"
              name="edit-staff-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={editMutation.isPending}
              autoComplete="off"
              required
            />
          </div>

          {/* Role Checkboxes */}
          <div className="space-y-2 pt-1">
            <Label className="text-xs font-medium">Role assignment</Label>

            <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/20">
              {AVAILABLE_ROLES.map((r) => {
                const isChecked = selectedRoles.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className="flex items-start gap-3 rounded-md p-1.5 hover:bg-background/80 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleRole(r.id)}
                      disabled={editMutation.isPending}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{r.title}</span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.2 text-[10px] font-mono text-slate-700">
                          {r.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {r.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {isLastAdminRoleRemovalRisk && (
              <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2">
                <strong>Last-Admin Guard:</strong> This account is the last
                active Administrator. Removing the ADMIN role will be rejected
                by security policy to prevent lockout.
              </p>
            )}

            {hasRegistrarAndApprover && (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
                <strong>Policy restriction:</strong> Combining Registrar and
                Approver roles allows self-approval and is rejected by default.
              </p>
            )}
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={editMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-[#0f172a] hover:bg-[#1e293b] text-white"
              disabled={editMutation.isPending}
            >
              {editMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
