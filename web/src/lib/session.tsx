import { createContext, useContext, type ReactNode } from 'react';
import type { Me } from './types';

/** The signed-in person, for every screen. */
export type Session = {
  me: Me['user'];
  /** The owner's display name (whose notes and PC these are), for a friend's wording. */
  ownerName: string;
  isOwner: boolean;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside a signed-in screen');
  return session;
}
