import { api, getApiErrorMessage } from "./client";

export interface StaffMember {
  id: string;
  staffId?: string;
  name: string;
  email: string;
  roles: string[];
  status: "ACTIVE" | "INACTIVE";
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateStaffPayload {
  name: string;
  email: string;
  password: string;
  roles: string[];
}

export interface UpdateStaffPayload {
  name?: string;
  email?: string;
  roles?: string[];
}

export async function getStaffList(): Promise<StaffMember[]> {
  const response = await api.get<StaffMember[]>("/staffs");
  return response.data;
}

export async function getStaffById(id: string): Promise<StaffMember> {
  const response = await api.get<StaffMember>(`/staffs/${id}`);
  return response.data;
}

export async function createStaff(payload: CreateStaffPayload): Promise<StaffMember> {
  const response = await api.post<StaffMember>("/staffs", payload);
  return response.data;
}

export async function updateStaff(id: string, payload: UpdateStaffPayload): Promise<StaffMember> {
  const response = await api.patch<StaffMember>(`/staffs/${id}`, payload);
  return response.data;
}

export async function deactivateStaff(id: string): Promise<StaffMember> {
  const response = await api.post<StaffMember>(`/staffs/${id}/deactivate`);
  return response.data;
}

export { getApiErrorMessage };
