import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  confirmSignUp as amplifyConfirmSignUp,
  fetchAuthSession,
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
} from 'aws-amplify/auth';

interface AuthContextValue {
  email: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  getIdToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function currentUserEmail(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user.signInDetails?.loginId ?? user.username;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void currentUserEmail()
      .then(setEmail)
      .finally(() => setIsLoading(false));
  }, []);

  const value: AuthContextValue = {
    email,
    isLoading,
    async signIn(username, password) {
      const { isSignedIn } = await amplifySignIn({ username, password });
      if (isSignedIn) {
        setEmail(await currentUserEmail());
      }
    },
    async signUp(username, password) {
      await amplifySignUp({
        username,
        password,
        options: { userAttributes: { email: username } },
      });
    },
    async confirmSignUp(username, code) {
      await amplifyConfirmSignUp({ username, confirmationCode: code });
    },
    async signOut() {
      await amplifySignOut();
      setEmail(null);
    },
    async getIdToken() {
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!token) {
        throw new Error('Not authenticated.');
      }
      return token;
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}
