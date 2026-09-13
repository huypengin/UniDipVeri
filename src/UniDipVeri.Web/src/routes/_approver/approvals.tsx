import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { StaffHeader } from "@/components/header/StaffHeader";

export const Route = createFileRoute("/_approver/approvals")({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: "/staff/approvals" },
      });
    }
    if (!context.auth.hasRole("APPROVER")) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [{ title: "Issuance Approvals — UniDipVeri" }],
  }),
  component: StaffApprovalsPage,
});

function StaffApprovalsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc] text-foreground">
      <StaffHeader
        onLogout={handleLogout}
        user={user}
        activeTab="approvals"
      />
      <main className="mx-auto w-full max-w-5xl flex-1 p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Issuance Approval Queue
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Independent verification review, multi-party consensus decisions, and
          audit commentary.
        </p>
      </main>
    </div>
  );
}
