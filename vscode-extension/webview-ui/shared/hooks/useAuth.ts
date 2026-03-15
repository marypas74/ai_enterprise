import { useState, useCallback } from 'react';

interface UserInfo {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: UserInfo | null;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
  });

  const setAuthenticated = useCallback((user: UserInfo) => {
    setAuth({ isAuthenticated: true, user });
  }, []);

  const setUnauthenticated = useCallback(() => {
    setAuth({ isAuthenticated: false, user: null });
  }, []);

  return { ...auth, setAuthenticated, setUnauthenticated };
}
