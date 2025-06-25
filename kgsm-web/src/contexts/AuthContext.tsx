import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

interface User {
  id: string;
  name: string;
  email: string;
  picture?: string;
  provider: 'google' | 'microsoft' | 'github' | 'local';
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  error: Error | null;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  error: null,
  login: () => {},
  logout: () => {}
});

interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Auth provider component that handles authentication state and methods
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [localUser, setLocalUser] = useState<User | null>(null);
  const [localIsAuthenticated, setLocalIsAuthenticated] = useState<boolean>(false);
  const [localIsLoading, setLocalIsLoading] = useState<boolean>(true);

  // Check if authentication should be bypassed completely
  const bypassAuth = process.env.REACT_APP_BYPASS_AUTH === 'true' || process.env.NODE_ENV === 'development';

  // Always call useAuth0 hook, but handle the case where it might not be available
  let auth0Result = {
    user: null as any,
    isAuthenticated: false,
    isLoading: false,
    error: null as Error | null,
    loginWithRedirect: () => {},
    logout: (options?: any) => {}
  };

  try {
    // Always call the hook to satisfy React's rules of hooks
    const auth0Hook = useAuth0();
    if (!bypassAuth) {
      auth0Result = {
        user: auth0Hook.user || null,
        isAuthenticated: auth0Hook.isAuthenticated,
        isLoading: auth0Hook.isLoading,
        error: auth0Hook.error || null,
        loginWithRedirect: auth0Hook.loginWithRedirect,
        logout: auth0Hook.logout
      };
    }
  } catch (error) {
    // Auth0 hook not available, continue with bypass mode
    console.log('Auth0 not available, using bypass mode');
  }

  const {
    user: auth0User,
    isAuthenticated: auth0IsAuthenticated,
    isLoading: auth0IsLoading,
    error: auth0Error,
    loginWithRedirect,
    logout: auth0Logout,
  } = auth0Result;

  useEffect(() => {
    // If authentication is bypassed, create a mock user
    if (bypassAuth) {
      setTimeout(() => {
        setLocalUser({
          id: 'local-dev-id',
          name: 'Local Developer',
          email: 'dev@localhost',
          provider: 'local'
        });
        setLocalIsAuthenticated(true);
        setLocalIsLoading(false);
      }, 500); // Simulate loading
    }
  }, [bypassAuth]);

  // Map Auth0 user to our user format when authenticated
  useEffect(() => {
    if (!bypassAuth && auth0IsAuthenticated && auth0User) {
      const mappedUser: User = {
        id: auth0User.sub || '',
        name: auth0User.name || '',
        email: auth0User.email || '',
        picture: auth0User.picture,
        provider: determineProvider(auth0User.sub || '')
      };
      setLocalUser(mappedUser);
      setLocalIsAuthenticated(true);
    } else if (!bypassAuth) {
      setLocalIsAuthenticated(false);
    }

    if (!bypassAuth) {
      setLocalIsLoading(auth0IsLoading);
    }
  }, [bypassAuth, auth0IsAuthenticated, auth0User, auth0IsLoading]);

  // Determine auth provider based on the user's sub identifier
  const determineProvider = (sub: string): 'google' | 'microsoft' | 'github' | 'local' => {
    if (sub.includes('google')) return 'google';
    if (sub.includes('microsoft') || sub.includes('windowslive')) return 'microsoft';
    if (sub.includes('github')) return 'github';
    return 'local';
  };

  const login = () => {
    if (bypassAuth) {
      setLocalIsAuthenticated(true);
    } else {
      loginWithRedirect();
    }
  };

  const logout = () => {
    if (bypassAuth) {
      setLocalUser(null);
      setLocalIsAuthenticated(false);
    } else {
      auth0Logout({ logoutParams: { returnTo: window.location.origin } });
    }
  };

  const value = {
    isAuthenticated: localIsAuthenticated,
    user: localUser,
    isLoading: localIsLoading,
    error: auth0Error,
    login,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook to use auth context
 */
export const useAuth = () => useContext(AuthContext);
