import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createStaff,
  getApiErrorMessage,
  type CreateStaffPayload,
} from "@/lib/api/staff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
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

interface CreateStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateStaffDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateStaffDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["REGISTRAR"]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setSelectedRoles(["REGISTRAR"]);
    setErrorMessage(null);
  };

  const createMutation = useMutation({
    mutationFn: (payload: CreateStaffPayload) => createStaff(payload),
    onSuccess: () => {
      toast.success("Staff account created successfully.");
      onSuccess();
      onOpenChange(false);
      resetForm();
    },
    onError: (err) => {
      const msg = getApiErrorMessage(err, "Failed to create staff account.");
      setErrorMessage(msg);
      toast.error(msg);
    },
  });

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const hasRegistrarAndApprover =
    selectedRoles.includes("REGISTRAR") && selectedRoles.includes("APPROVER");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage("Please enter a staff name.");
      return;
    }
    if (!email.trim()) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }
    if (!password.trim()) {
      setErrorMessage("Please enter an initial password.");
      return;
    }
    if (selectedRoles.length === 0) {
      setErrorMessage("At least one role must be assigned.");
      return;
    }

    createMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      password,
      roles: selectedRoles,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) resetForm();
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="sm:max-w-120">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Create staff account
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Provision a new university staff account and assign their access
            permissions.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 pt-2"
          autoComplete="off"
        >
          {/* Hidden decoy fields to prevent browser from auto-filling saved admin credentials */}
          <input
            type="text"
            name="fake_username_autofill_block"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-9999px",
              left: "-9999px",
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          <input
            type="password"
            name="fake_password_autofill_block"
            tabIndex={-1}
            autoComplete="new-password"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-9999px",
              left: "-9999px",
              opacity: 0,
              pointerEvents: "none",
            }}
          />

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
            <Label htmlFor="create-staff-name" className="text-xs font-medium">
              Full name
            </Label>
            <Input
              id="create-staff-name"
              name="new-staff-name"
              placeholder="e.g. Nguyen Van A"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={createMutation.isPending}
              autoComplete="off"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-staff-email" className="text-xs font-medium">
              Staff email
            </Label>
            <Input
              id="create-staff-email"
              name="new-staff-email"
              type="email"
              placeholder="e.g. a.van.nguyen@staff.miu.example"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={createMutation.isPending}
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="create-staff-password"
              className="text-xs font-medium"
            >
              Initial password
            </Label>
            <PasswordInput
              id="create-staff-password"
              name="new-staff-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={createMutation.isPending}
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              required
            />
          </div>

          {/* Role Checkboxes */}
          <div className="space-y-2 pt-1">
            <Label className="text-xs font-medium">Role assignment</Label>
            <p className="text-[11px] text-muted-foreground">
              Select one or more roles for this staff account.
            </p>

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
                      disabled={createMutation.isPending}
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

            {hasRegistrarAndApprover && (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
                <strong>Policy restriction:</strong> Combining Registrar and
                Approver roles on one account allows self-approval and is
                rejected by default unless explicitly permitted by deployment
                policy.
              </p>
            )}
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-[#0f172a] hover:bg-[#1e293b] text-white"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create staff account"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
