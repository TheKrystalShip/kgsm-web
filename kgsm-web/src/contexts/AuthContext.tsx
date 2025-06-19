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

  const {
    user: auth0User,
    isAuthenticated: auth0IsAuthenticated,
    isLoading: auth0IsLoading,
    error: auth0Error,
    loginWithRedirect,
    logout: auth0Logout,
  } = useAuth0();

  // Check if we're in development mode for bypass
  const isDev = process.env.NODE_ENV === 'development';

  useEffect(() => {
    // If in development, create a mock user for authentication bypass
    if (isDev) {
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
  }, [isDev]);

  // Map Auth0 user to our user format when authenticated
  useEffect(() => {
    if (!isDev && auth0IsAuthenticated && auth0User) {
      const mappedUser: User = {
        id: auth0User.sub || '',
        name: auth0User.name || '',
        email: auth0User.email || '',
        picture: auth0User.picture,
        provider: determineProvider(auth0User.sub || '')
      };
      setLocalUser(mappedUser);
      setLocalIsAuthenticated(true);
    } else if (!isDev) {
      setLocalIsAuthenticated(false);
    }
    
    if (!isDev) {
      setLocalIsLoading(auth0IsLoading);
    }
  }, [isDev, auth0IsAuthenticated, auth0User, auth0IsLoading]);

  // Determine auth provider based on the user's sub identifier
  const determineProvider = (sub: string): 'google' | 'microsoft' | 'github' | 'local' => {
    if (sub.includes('google')) return 'google';
    if (sub.includes('microsoft') || sub.includes('windowslive')) return 'microsoft';
    if (sub.includes('github')) return 'github';
    return 'local';
  };

  const login = () => {
    if (isDev) {
      setLocalIsAuthenticated(true);
    } else {
      loginWithRedirect();
    }
  };

  const logout = () => {
    if (isDev) {
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
    error: auth0Error ?? null,
    login,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook to use auth context
 */
export const useAuth = () => useContext(AuthContext);
