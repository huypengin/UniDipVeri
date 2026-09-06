import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { GraduationCap, LogOut } from "lucide-react";

export const Route = createFileRoute("/staff/operations")({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: "/staff/operations" },
      });
    }
    if (!context.auth.hasRole("REGISTRAR")) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [{ title: "Registrar Operations — UniDipVeri" }],
  }),
  component: StaffOperationsPage,
});

function StaffOperationsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="h-6 w-6 text-primary" />
            <div>
              <span className="text-sm font-semibold text-foreground">
                UniDipVeri
              </span>
              <span className="ml-2 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
                Registrar Operations
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Registrar Operations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cohort graduation evaluation, issuance request creation, and academic
          program records.
        </p>
      </main>
    </div>
  );
}
