import { useAuthStore } from './useAuthStore';

export const useAuth = () => {
  const { accessToken, user, isAuthenticated } = useAuthStore();
  return {
    token: accessToken,
    user,
    isAuthenticated
  };
};

export { useAuthStore };
