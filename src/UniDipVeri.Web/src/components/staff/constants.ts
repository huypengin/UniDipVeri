export const AVAILABLE_ROLES = [
  {
    id: "ADMIN",
    label: "ADMIN",
    title: "Administrator",
    description: "Full administrative access and user management",
  },
  {
    id: "REGISTRAR",
    label: "REGISTRAR",
    title: "Registrar",
    description: "Academic record review and credential issuance requests",
  },
  {
    id: "APPROVER",
    label: "APPROVER",
    title: "Approver",
    description: "Review and approve/reject credential issuance requests",
  },
] as const;
