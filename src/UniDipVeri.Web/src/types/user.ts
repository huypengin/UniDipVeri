export type UserType = "student" | "staff";

export interface UserProfileData {
  id: string;
  email: string;
  name: string;
  role: string;
  roles: string[];
  userType: "student" | "staff";
  studentNumber?: string;
  institution?: string;
}
