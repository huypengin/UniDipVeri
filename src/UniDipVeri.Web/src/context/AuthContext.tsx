import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { UserProfileData } from "@/types/user";

export type { UserProfileData } from "@/types/user";

export type StaffRole = "ADMIN" | "REGISTRAR" | "APPROVER" | "STAFF";

export interface AuthContextType {
  user: UserProfileData | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (
    email: string,
    password: string,
    portalType: UserProfileData["userType"],
  ) => Promise<UserProfileData>;

  logout: () => Promise<void>;

  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
}

interface AuthApiResponse {
  id: string;
  email: string;
  name: string;
  role?: string;
  roles?: string[];
  userType: UserProfileData["userType"];
  studentNumber?: string | null;
  institution?: string | null;
}

function normalizeUser(data: AuthApiResponse): UserProfileData {
  const roles =
    data.roles && data.roles.length > 0
      ? data.roles.map((r) => r.toUpperCase())
      : data.role
        ? [data.role.toUpperCase()]
        : [];

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    role: roles[0] ?? "",
    roles,
    userType: data.userType,

    ...(data.studentNumber != null
      ? { studentNumber: data.studentNumber }
      : {}),

    ...(data.institution != null ? { institution: data.institution } : {}),
  };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let isMounted = true;

    api
      .get<AuthApiResponse>("/auth/me")
      .then((res) => {
        if (isMounted && res.data) {
          setUser(normalizeUser(res.data));
        }
      })
      .catch(() => {
        if (isMounted) {
          queryClient.clear();
          setUser(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [queryClient]);

  const login = useCallback(
    async (
      email: string,
      password: string,
      portalType: UserProfileData["userType"],
    ): Promise<UserProfileData> => {
      const endpoint =
        portalType === "student" ? "/students/login" : "/staffs/login";

      const response = await api.post<AuthApiResponse>(endpoint, {
        email,
        password,
      });

      const authenticatedUser = normalizeUser(response.data);

      queryClient.clear();

      flushSync(() => {
        setUser(authenticatedUser);
      });

      return authenticatedUser;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      console.error("Logout request failed:", err);
    } finally {
      queryClient.clear();

      flushSync(() => {
        setUser(null);
      });
    }
  }, [queryClient]);

  const hasRole = useCallback(
    (role: string) => {
      return user?.roles.includes(role.toUpperCase()) ?? false;
    },
    [user],
  );

  const hasAnyRole = useCallback(
    (requiredRoles: string[]) => {
      if (!user) return false;

      const normalized = requiredRoles.map((r) => r.toUpperCase());

      return user.roles.some((r) => normalized.includes(r));
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: Boolean(user),
        isLoading,
        login,
        logout,
        hasRole,
        hasAnyRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
