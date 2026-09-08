import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getStaffList,
  getApiErrorMessage,
  type StaffMember,
} from "@/lib/api/staff";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  StaffRow,
  CreateStaffDialog,
  EditStaffDialog,
  DeactivateStaffDialog,
} from "@/components/staff";
import { UserPlus, AlertCircle, Users } from "lucide-react";

export const Route = createFileRoute("/_admin/staffs")({
  head: () => ({
    meta: [
      { title: "Staff accounts — UniDipVeri Admin" },
      {
        name: "description",
        content:
          "Create staff accounts, assign REGISTRAR, APPROVER or ADMIN roles, and deactivate accounts.",
      },
    ],
  }),
  component: StaffUsersPage,
});

function StaffUsersPage() {
  const queryClient = useQueryClient();

  // Dialog states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [deactivatingStaff, setDeactivatingStaff] = useState<StaffMember | null>(
    null,
  );

  // Queries
  const {
    data: staffMembers = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["staffs"],
    queryFn: getStaffList,
  });

  const activeAdminsCount = staffMembers.filter(
    (s) => s.status === "ACTIVE" && s.roles.includes("ADMIN"),
  ).length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      {/* Page title and Create button */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Staff accounts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create accounts for university staff and control what each of them
            is allowed to do.
          </p>
        </div>
        <div>
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="bg-[#0f172a] hover:bg-[#1e293b] text-white font-medium shadow-sm transition-all gap-2 px-4 py-2 h-9 rounded-lg"
          >
            <UserPlus className="h-4 w-4" />
            <span>Create staff account</span>
          </Button>
        </div>
      </div>

      {/* Staff accounts container / list matching mockup */}
      <div className="mt-8 rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                      <Skeleton className="h-4 w-20 rounded-md" />
                    </div>
                    <Skeleton className="h-3 w-64" />
                  </div>
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              Failed to load staff accounts
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
        ) : staffMembers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
              <Users className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              No staff accounts found
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Get started by creating the first university staff account.
            </p>
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="mt-4 bg-[#0f172a] hover:bg-[#1e293b] text-white"
              size="sm"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Create staff account
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {staffMembers.map((staff, idx) => (
              <StaffRow
                key={staff.id}
                staff={staff}
                index={idx}
                onEdit={setEditingStaff}
                onDeactivate={setDeactivatingStaff}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Staff Modal */}
      <CreateStaffDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["staffs"] });
        }}
      />

      {/* Edit Staff Modal */}
      {editingStaff && (
        <EditStaffDialog
          staff={editingStaff}
          activeAdminsCount={activeAdminsCount}
          open={Boolean(editingStaff)}
          onOpenChange={(open) => {
            if (!open) setEditingStaff(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["staffs"] });
          }}
        />
      )}

      {/* Deactivate Confirmation Dialog */}
      {deactivatingStaff && (
        <DeactivateStaffDialog
          staff={deactivatingStaff}
          activeAdminsCount={activeAdminsCount}
          open={Boolean(deactivatingStaff)}
          onOpenChange={(open) => {
            if (!open) setDeactivatingStaff(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["staffs"] });
          }}
        />
      )}
    </main>
  );
}

