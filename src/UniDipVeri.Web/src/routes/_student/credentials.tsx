import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_student/credentials")({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: "/_student/credentials" },
      });
    }
    if (!context.auth.hasRole("STUDENT")) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [{ title: "My Credentials — UniDipVeri Student Portal" }],
  }),
  component: StudentCredentialsPage,
});

function StudentCredentialsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-5xl flex-1 p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          My Credentials
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View issued digital diplomas, create time-limited share links, and
          audit verification activity.
        </p>
      </main>
    </div>
  );
}
