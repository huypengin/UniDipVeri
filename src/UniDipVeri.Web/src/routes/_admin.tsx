import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { StaffHeader } from "@/components/header/StaffHeader";

export const Route = createFileRoute("/_admin")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    if (!context.auth.hasRole("ADMIN")) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { logout, user } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc] text-foreground">
      <StaffHeader onLogout={handleLogout} user={user} activeTab="staffs" />

      <Outlet />
    </div>
  );
}
