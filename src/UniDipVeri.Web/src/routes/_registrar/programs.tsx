import { useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  getProgramsList,
  getApiErrorMessage,
  type Program,
} from "@/lib/api/programs";
import { StaffHeader } from "@/components/header/StaffHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ProgramCard,
  CreateProgramDialog,
  EditProgramDialog,
} from "@/components/program";
import { Plus, AlertCircle, GraduationCap } from "lucide-react";

export const Route = createFileRoute("/_registrar/programs")({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({
        to: "/login",
        search: { redirect: "/programs" },
      });
    }
    if (!context.auth.hasRole("REGISTRAR")) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Academic Programs — UniDipVeri Registrar" },
      {
        name: "description",
        content:
          "Define program curriculum, degree levels, and student cohort configurations.",
      },
    ],
  }),
  component: ProgramsManagementPage,
});

function ProgramsManagementPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);

  const handleLogout = async () => {
    await logout();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  };

  // Queries
  const {
    data: programs = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["programs"],
    queryFn: getProgramsList,
  });

  return (
    <div className="flex min-h-screen flex-col bg-[#f8fafc] text-foreground">
      <StaffHeader onLogout={handleLogout} user={user} activeTab="programs" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {/* Page Title & Create Program Action */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Academic programs
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Define program curriculum, degree levels, and student cohort
              definitions.
            </p>
          </div>
          <div>
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="bg-[#0f172a] hover:bg-[#1e293b] text-white font-medium shadow-sm transition-all gap-2 px-4 py-2 h-9 rounded-lg cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create program</span>
            </Button>
          </div>
        </div>

        {/* Programs List Container */}
        <div className="mt-8 rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-5">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                  <Skeleton className="h-8 w-16 rounded-lg" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Failed to load academic programs
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {getApiErrorMessage(error)}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => refetch()}
              >
                Try again
              </Button>
            </div>
          ) : programs.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                <GraduationCap className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                No academic programs found
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Get started by creating the first university academic program.
              </p>
              <Button
                onClick={() => setIsCreateOpen(true)}
                className="mt-4 bg-[#0f172a] hover:bg-[#1e293b] text-white"
                size="sm"
              >
                <Plus className="mr-2 h-4 w-4" />
                Create program
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {programs.map((program) => (
                <ProgramCard
                  key={program.id}
                  program={program}
                  onEdit={setEditingProgram}
                />
              ))}
            </div>
          )}
        </div>

        {/* Create Program Modal */}
        <CreateProgramDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["programs"] });
          }}
        />

        {/* Edit Program Modal */}
        {editingProgram && (
          <EditProgramDialog
            key={editingProgram.id}
            program={editingProgram}
            open={Boolean(editingProgram)}
            onOpenChange={(open) => {
              if (!open) setEditingProgram(null);
            }}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["programs"] });
            }}
          />
        )}
      </main>
    </div>
  );
}
