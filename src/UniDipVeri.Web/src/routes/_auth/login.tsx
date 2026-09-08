import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api/client";

interface LoginSearchParams {
  redirect?: string | undefined;
}

export const Route = createFileRoute("/_auth/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearchParams => ({
    redirect:
      typeof search["redirect"] === "string" ? search["redirect"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Institutional Sign In — UniDipVeri" },
      {
        name: "description",
        content:
          "Sign in to UniDipVeri for students, registrars, approvers, and administrators.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login } = useAuth();
  const search = Route.useSearch();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleType, setRoleType] = useState<"student" | "staff">("student");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-detect role type from institutional email suffix if user types it
  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (val.includes("@staff.")) setRoleType("staff");
    else if (val.includes("@student.")) setRoleType("student");
  };

  const handleSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please enter both email and password.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const user = await login(email.trim(), password, roleType);
      await router.invalidate();

      // Automated Role Dispatching (docs/05-ux/UI_UX_Design.md Section 2.1)
      const targetRedirect =
        search.redirect &&
        search.redirect !== "/login" &&
        search.redirect !== "/_auth/login"
          ? search.redirect
          : null;

      if (targetRedirect) {
        await router.navigate({ href: targetRedirect });
      } else if (user.roles.includes("ADMIN")) {
        await router.navigate({ to: "/staffs" });
      } else if (user.roles.includes("APPROVER")) {
        await router.navigate({ to: "/approvals" });
      } else if (user.roles.includes("REGISTRAR")) {
        await router.navigate({ to: "/operations" });
      } else {
        await router.navigate({ to: "/my/credentials" });
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-card-foreground">
          Institutional Sign in
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Sign in to access your authorized UniDipVeri records and services.
        </p>
      </div>

      {/* Role Mode Segmented Control */}
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => setRoleType("student")}
          className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
            roleType === "student"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Students
        </button>
        <button
          type="button"
          onClick={() => setRoleType("staff")}
          className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
            roleType === "staff"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Staffs
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">
            {roleType === "student"
              ? "Student Email"
              : "Institutional Staff Email"}
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={
              roleType === "student"
                ? "student@student.miu.example"
                : "staff@staff.miu.example"
            }
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/reset-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
              Verifying Credentials...
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </div>
  );
}
