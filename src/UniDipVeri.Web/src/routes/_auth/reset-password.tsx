import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Mail,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { api, getApiErrorMessage } from "@/lib/api/client";

interface ResetPasswordSearchParams {
  token?: string | undefined;
}

export const Route = createFileRoute("/_auth/reset-password")({
  validateSearch: (
    search: Record<string, unknown>,
  ): ResetPasswordSearchParams => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Password Reset & Activation — UniDipVeri" },
      {
        name: "description",
        content:
          "Password recovery and first-time activation for students and staff.",
      },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();

  // If token is provided in the URL, render the confirmation / set new password view
  if (token) {
    return <ConfirmPasswordView token={token} />;
  }

  return <RequestResetView />;
}

function RequestResetView() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your institutional email address.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await api.post("/auth/reset-password", { email: email.trim() });
      setIsSubmitted(true);
    } catch {
      // Anti-enumeration: show success confirmation even on error
      setIsSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-card-foreground">
          Check your email
        </h1>
        <p className="text-sm text-muted-foreground">
          If an institutional account exists for{" "}
          <span className="font-medium text-foreground">{email}</span>, we have
          dispatched a single-use, time-limited link to establish or reset your
          credentials.
        </p>
        <div className="pt-4">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Return to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">
          Reset password
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We&apos;ll email a single-use reset link to your institutional
          address.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Institutional email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@student.miu.example or you@staff.miu.example"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending instructions...
            </>
          ) : (
            <>
              <Mail className="mr-2 h-4 w-4" />
              Send reset link
            </>
          )}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export function ConfirmPasswordView({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
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
      await api.post("/auth/reset-password/confirm", {
        token: token.trim(),
        newPassword,
      });
      setIsSuccess(true);
    } catch (err: unknown) {
      setError(
        getApiErrorMessage(
          err,
          "Failed to update password. The link may be invalid or expired.",
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-card-foreground">
          Password updated
        </h1>
        <p className="text-sm text-muted-foreground">
          Your credentials have been successfully updated. You can now sign in
          with your new password.
        </p>
        <div className="pt-4">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Proceed to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">
          Set new password
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Enter and confirm your new institutional password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="newPassword">New password</Label>
          <PasswordInput
            id="newPassword"
            autoComplete="new-password"
            placeholder="At least 8 characters"
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
            placeholder="Re-type your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Updating password...
            </>
          ) : (
            <>
              <KeyRound className="mr-2 h-4 w-4" />
              Update password
            </>
          )}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link
          to="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
