import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { GraduationCap, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_auth")({
  beforeLoad: ({ context, location }) => {
    // If user already has an active session, redirect to return URL or role home
    if (context.auth.isAuthenticated) {
      const search = location.search as { redirect?: string };
      if (
        search?.redirect &&
        search.redirect !== "/login" &&
        search.redirect !== "/_auth/login"
      ) {
        throw redirect({ href: search.redirect });
      }
      throw redirect({ to: "/" });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Shared Institutional Header */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="h-6 w-6 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                UniDipVeri
              </span>
              <span className="text-xs text-muted-foreground">
                Mekong International University
              </span>
            </div>
          </div>
          <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            Universal Sign-in
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-105 rounded-xl border border-border bg-card p-8 shadow-sm">
          {/* Child route content (form only) */}
          <Outlet />

          {/* Shared Security & Audit Disclaimer */}
          <div className="mt-8 border-t border-border pt-5">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/80" />
              <span>
                Each account can access only authorized institutional records.
                All sign-in and verification attempts are audited for regulatory
                compliance.
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
