import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    if (!context.auth?.isAuthenticated) {
      throw redirect({ to: "/login" });
    }

    const user = context.auth.user;
    if (user?.roles.includes("ADMIN")) {
      throw redirect({ to: "/staff/users" });
    } else if (user?.roles.includes("APPROVER")) {
      throw redirect({ to: "/staff/approvals" });
    } else if (user?.roles.includes("REGISTRAR")) {
      throw redirect({ to: "/staff/operations" });
    } else {
      throw redirect({ to: "/student/credentials" });
    }
  },
  component: () => null,
});
