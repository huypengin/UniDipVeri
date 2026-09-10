import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api/client";
import { AdminHeader } from "@/components/header/AdminHeader";
import { StudentHeader } from "@/components/header/StudentHeader";
import { SharedAccountManagement } from "@/components/account/SharedAccountManagement";
import { ShieldCheck, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserProfileData } from "@/context/AuthContext";

export const Route = createFileRoute("/account")({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: "/account" },
      });
    }
  },
  head: () => ({
    meta: [
      { title: "Account Management — UniDipVeri" },
      {
        name: "description",
        content:
          "Manage your personal institutional account details and credentials.",
      },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, hasRole, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  };

  const { data: profile } = useQuery<UserProfileData>({
    queryKey: ["auth", "me", user?.id],
    queryFn: async () => {
      const res = await api.get<UserProfileData>("/me");
      return res.data;
    },
    enabled: Boolean(user?.id),
    staleTime: 10_000,
  });

  // Render role-appropriate portal header
  const renderHeader = () => {
    if (hasRole("ADMIN")) {
      return (
        <AdminHeader onLogout={handleLogout} activeTab="account" user={user} />
      );
    }

    if (hasRole("STUDENT") || user?.userType === "student") {
      return (
        <StudentHeader
          onLogout={handleLogout}
          activeTab="account"
          user={user}
        />
      );
    }

    // Default institutional staff header for Registrar / Approver
    return (
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0f172a] text-white shadow-xs">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold leading-tight tracking-tight text-foreground">
                UniDipVeri
              </span>
              <span className="text-xs text-muted-foreground leading-tight">
                Staff Operations
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-full border-border px-3 text-xs font-medium text-foreground gap-1.5 shadow-2xs hover:bg-muted"
            onClick={handleLogout}
          >
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            Sign out
          </Button>
        </div>
      </header>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {renderHeader()}
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <SharedAccountManagement profileOverride={profile} />
      </main>
    </div>
  );
}
