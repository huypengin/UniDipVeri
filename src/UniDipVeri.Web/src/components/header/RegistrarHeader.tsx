import { StaffHeader, type StaffHeaderProps } from "./StaffHeader";

export type RegistrarHeaderProps = StaffHeaderProps;

export function RegistrarHeader(props: RegistrarHeaderProps) {
  return <StaffHeader {...props} />;
}
