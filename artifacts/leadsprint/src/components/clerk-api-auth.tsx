import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

/** Do not mount API consumers until Clerk's renewable token getter is installed.
 * Cookies alone are unreliable on proxied / split-origin deployments. Tokens
 * stay in Clerk's memory; never persist them or bake a secret into the bundle.
 */
export function ClerkApiAuth({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn, sessionId } = useAuth();
  const [registeredSession, setRegisteredSession] = useState<string | null | undefined>();

  useEffect(() => {
    if (!isLoaded) return;
    setAuthTokenGetter(isSignedIn ? () => getToken() : null);
    setRegisteredSession(sessionId ?? null);
    return () => setAuthTokenGetter(null);
  }, [getToken, isLoaded, isSignedIn, sessionId]);

  if (!isLoaded || registeredSession !== (sessionId ?? null)) return null;
  return children;
}
