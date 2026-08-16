import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { touchPresence } from "@/lib/friends";
import { supabase } from "@/lib/supabase";

/** How often the heartbeat repeats while the app stays in the foreground. */
const PRESENCE_BEAT_MS = 5 * 60 * 1000;

type AuthState = {
  session: Session | null;
  /** False until the persisted session has been read from storage. */
  ready: boolean;
};

const AuthContext = createContext<AuthState>({ session: null, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    ready: false,
  });

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, ready: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, ready: true });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* The presence heartbeat lives here because this is the one provider that
     knows whether anyone is signed in. Coming to the foreground touches
     right away; the interval keeps a long study session reading "Active
     now" without another tap. touchPresence throttles itself and swallows
     every failure, so this wiring stays dumb on purpose: no state, no
     errors, nothing for a screen to react to. Keyed on the user id rather
     than the session object, so a token refresh doesn't tear it down. */
  const userId = state.session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    void touchPresence();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void touchPresence();
    });
    const beat = setInterval(() => {
      // A phone asleep in a bag isn't "active", so the background beats
      // stay quiet and the label ages out honestly.
      if (AppState.currentState === "active") void touchPresence();
    }, PRESENCE_BEAT_MS);
    return () => {
      sub.remove();
      clearInterval(beat);
    };
  }, [userId]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
