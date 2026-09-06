import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { api } from "@/lib/api/client";

export type UserType = "student" | "staff";

export type StaffRole = "ADMIN" | "REGISTRAR" | "APPROVER" | "STAFF";

export interface User {
  id: string;
  email: string;
  userType: UserType;
  roles: string[];
  studentNumber?: string | undefined;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (
    email: string,
    password: string,
    portalType: UserType,
  ) => Promise<User>;

  logout: () => Promise<void>;

  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
}

interface AuthApiResponse {
  id: string;
  email: string;
  role?: string;
  roles?: string[];
  userType: UserType;
  studentNumber?: string | null;
}

function normalizeUser(data: AuthApiResponse): User {
  const roles =
    data.roles && data.roles.length > 0
      ? data.roles.map((r) => r.toUpperCase())
      : data.role
        ? [data.role.toUpperCase()]
        : [];

  return {
    id: data.id,
    email: data.email,
    userType: data.userType,
    roles,
    studentNumber: data.studentNumber ?? undefined,
  };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on initial load via HttpOnly session cookie
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
  }, []);

  const login = useCallback(
    async (
      email: string,
      password: string,
      portalType: UserType,
    ): Promise<User> => {
      const endpoint =
        portalType === "student" ? "/students/login" : "/staffs/login";

      const response = await api.post<AuthApiResponse>(endpoint, {
        email,
        password,
      });

      const authenticatedUser = normalizeUser(response.data);
      flushSync(() => {
        setUser(authenticatedUser);
      });
      return authenticatedUser;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch (err) {
      console.error("Logout request failed:", err);
    } finally {
      flushSync(() => {
        setUser(null);
      });
    }
  }, []);

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
