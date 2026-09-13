import { api, getApiErrorMessage } from "./client";

export type DegreeLevel = "BACHELOR" | "MASTER" | "DOCTORATE" | "ASSOCIATE";
export type ProgramStatus = "ACTIVE" | "INACTIVE";

export interface Program {
  id: string;
  programId?: string;
  universityId: string;
  name: string;
  fullTitle: string;
  degreeLevel: DegreeLevel;
  status: ProgramStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProgramPayload {
  name: string;
  fullTitle: string;
  degreeLevel: DegreeLevel;
}

export interface UpdateProgramPayload {
  name?: string;
  fullTitle?: string;
  degreeLevel?: DegreeLevel;
  status?: ProgramStatus;
}

export async function getProgramsList(): Promise<Program[]> {
  const response = await api.get<Program[]>("/programs");
  return response.data;
}

export async function getProgramById(id: string): Promise<Program> {
  const response = await api.get<Program>(`/programs/${id}`);
  return response.data;
}

export async function createProgram(payload: CreateProgramPayload): Promise<Program> {
  const response = await api.post<Program>("/programs", payload);
  return response.data;
}

export async function updateProgram(id: string, payload: UpdateProgramPayload): Promise<Program> {
  const response = await api.patch<Program>(`/programs/${id}`, payload);
  return response.data;
}

export { getApiErrorMessage };
