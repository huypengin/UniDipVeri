import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { ConfirmPasswordView } from "./reset-password";

interface ConfirmSearchParams {
  token?: string | undefined;
}

export const Route = createFileRoute("/_auth/reset-password/confirm")({
  validateSearch: (search: Record<string, unknown>): ConfirmSearchParams => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Set New Password — UniDipVeri" },
      {
        name: "description",
        content: "Confirm password reset or first-time account activation.",
      },
    ],
  }),
  component: ResetPasswordConfirmPage,
});

function ResetPasswordConfirmPage() {
  const { token } = Route.useSearch();

  if (!token) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-card-foreground">
          Missing Reset Token
        </h1>
        <p className="text-sm text-muted-foreground">
          The reset link you followed is missing the required security token. Please request a new link.
        </p>
        <div className="pt-4">
          <Link
            to="/reset-password"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Request New Reset Link
          </Link>
        </div>
      </div>
    );
  }

  return <ConfirmPasswordView token={token} />;
}

