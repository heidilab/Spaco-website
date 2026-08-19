'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { onAuthChange, getStaffRole, ensureUserProfile } from '@/lib/auth';
import { StaffRole, ROLE_PERMISSIONS } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdminUser: boolean;
  userRole: StaffRole | null;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdminUser: false,
  userRole: null,
  hasPermission: () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<StaffRole | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthChange(async (firebaseUser) => {
      setUser(firebaseUser);
      // Defensive: if Firestore permission denies the admin_users read
      // we MUST still flip loading=false, otherwise the entire admin UI
      // is permanently stuck on "Loading…".
      try {
        if (firebaseUser) {
          // Self-heal missing users/{uid} docs (fire-and-forget).
          ensureUserProfile(firebaseUser);
          const role = await getStaffRole(firebaseUser.uid);
          setUserRole(role);
        } else {
          setUserRole(null);
        }
      } catch (err) {
        console.warn('[Auth] getStaffRole failed:', err);
        setUserRole(null);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const isAdminUser = userRole !== null;

  const hasPermission = (permission: string): boolean => {
    if (!userRole) return false;
    return ROLE_PERMISSIONS[userRole]?.includes(permission) ?? false;
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdminUser, userRole, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
