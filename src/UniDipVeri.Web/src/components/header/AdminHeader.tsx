import { StaffHeader, type StaffHeaderProps } from "./StaffHeader";

export type AdminHeaderProps = StaffHeaderProps;

export function AdminHeader(props: AdminHeaderProps) {
  return <StaffHeader {...props} />;
}
