import { StudentHeader } from "@/components/header/StudentHeader";
import { useAuth } from "@/context/AuthContext";
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
} from "@tanstack/react-router";

export const Route = createFileRoute("/_student")({
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: location.href },
      });
    }
    if (!context.auth.hasRole("STUDENT")) {
      throw redirect({ to: "/" });
    }
  },
  component: StudenLayout,
});

function StudenLayout() {
  const { logout, user } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc] text-foreground">
      <StudentHeader onLogout={handleLogout} user={user} />

      <Outlet />
    </div>
  );
}
