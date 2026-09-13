import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api/client";
import { StaffHeader } from "@/components/header/StaffHeader";
import { StudentHeader } from "@/components/header/StudentHeader";
import { SharedAccountManagement } from "@/components/account/SharedAccountManagement";
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
    if (hasRole("STUDENT") || user?.userType === "student") {
      return (
        <StudentHeader
          onLogout={handleLogout}
          activeTab="account"
          user={user}
        />
      );
    }

    // Institutional staff header (supports single and multiple roles: ADMIN, REGISTRAR, APPROVER)
    return (
      <StaffHeader
        onLogout={handleLogout}
        activeTab="account"
        user={user}
      />
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
