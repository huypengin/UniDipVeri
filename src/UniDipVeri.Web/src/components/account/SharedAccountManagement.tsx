import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, getApiErrorMessage } from "@/lib/api/client";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import type { UserProfileData } from "@/context/AuthContext";

export function SharedAccountManagement({
  profileOverride,
}: {
  profileOverride?: UserProfileData | undefined;
}) {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard against stale cache data from a different user session
  const isMatchingProfile =
    profileOverride && user
      ? profileOverride.id === user.id || profileOverride.email === user.email
      : true;
  const effectiveProfile = isMatchingProfile ? profileOverride : undefined;

  const name = effectiveProfile?.name.trim() ?? user?.name.trim() ?? "";
  const email = effectiveProfile?.email ?? user?.email ?? "";
  const userType = effectiveProfile?.userType ?? user?.userType ?? "student";
  const roles = effectiveProfile?.roles ?? user?.roles ?? [];
  const studentNumber = effectiveProfile?.studentNumber ?? user?.studentNumber;
  const institution =
    effectiveProfile?.institution ?? "Mekong International University";

  const handlePasswordSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill in all password fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasDigitOrSpecial = /[\d\W_]/.test(newPassword);
    if (!hasLetter || !hasDigitOrSpecial) {
      setError(
        "Password must contain at least one letter and at least one number or special character.",
      );
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await api.post("/auth/change-password", {
        currentPassword,
        newPassword,
      });

      toast.success("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, "Failed to update password.");
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format roles for display
  const formatRoleName = (r: string) => {
    switch (r.toUpperCase()) {
      case "ADMIN":
        return "Platform administrator";
      case "REGISTRAR":
        return "University registrar";
      case "APPROVER":
        return "Credential approver";
      case "STUDENT":
        return "Student";
      default:
        return r;
    }
  };

  return (
    <div className="space-y-8">
      {/* Heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Account
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Basic account details and password management.
        </p>
      </div>

      {/* Profile Details Card - Matches student-acc-manage.png Figure 2.3 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="divide-y divide-border">
          <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4">
            <span className="w-48 text-sm font-medium text-muted-foreground">
              Name
            </span>
            <span className="mt-1 sm:mt-0 text-sm font-medium text-foreground">
              {name}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4">
            <span className="w-48 text-sm font-medium text-muted-foreground">
              {userType === "student" ? "Student email" : "Institutional email"}
            </span>
            <span className="mt-1 sm:mt-0 text-sm font-medium text-foreground">
              {email}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4">
            <span className="w-48 text-sm font-medium text-muted-foreground">
              Institution
            </span>
            <span className="mt-1 sm:mt-0 text-sm font-medium text-foreground">
              {institution}
            </span>
          </div>

          {roles.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4">
              <span className="w-48 text-sm font-medium text-muted-foreground">
                Role(s)
              </span>
              <div className="mt-1 sm:mt-0 flex flex-wrap gap-1.5">
                {roles.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {formatRoleName(r)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {studentNumber && (
            <div className="flex flex-col sm:flex-row sm:items-center px-6 py-4">
              <span className="w-48 text-sm font-medium text-muted-foreground">
                Student number
              </span>
              <span className="mt-1 sm:mt-0 text-sm font-medium text-foreground">
                {studentNumber}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Change Password Card - Matches student-acc-manage.png Figure 2.3 */}
      <div className="max-w-md rounded-xl border border-border bg-card p-6 shadow-xs">
        <h2 className="text-base font-semibold text-card-foreground">
          Change password
        </h2>

        <form onSubmit={handlePasswordSubmit} className="mt-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Current password</Label>
            <PasswordInput
              id="currentPassword"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <PasswordInput
              id="newPassword"
              autoComplete="new-password"
              placeholder="••••••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              placeholder="••••••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          {error && (
            <Alert variant="destructive" className="py-2.5">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <div className="pt-2">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[#1e293b] text-white hover:bg-[#0f172a] shadow-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating password...
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
