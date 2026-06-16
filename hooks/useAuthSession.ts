import { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { User } from '../types';

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | string;

type SessionCallbackPayload = {
  event: AuthEvent;
  user: User;
  profile: any;
  session: any;
};

type UseAuthSessionOptions = {
  onSession?: (payload: SessionCallbackPayload) => Promise<void> | void;
  onSignedOut?: () => Promise<void> | void;
  onBeforeSignOut?: () => void;
};

const getMetadataAvatar = (metadata: any): string =>
  metadata?.avatar_url || metadata?.picture || '';

const mapSupabaseUser = (sessionUser: any, profile: any): User => ({
  id: sessionUser.id,
  email: sessionUser.email || '',
  name: profile?.name || sessionUser.user_metadata?.full_name || sessionUser.email?.split('@')[0] || 'User',
  avatar: profile?.avatar_url || getMetadataAvatar(sessionUser.user_metadata) || '',
  geminiApiKey: profile?.gemini_api_key || '',
});

export const useAuthSession = (options: UseAuthSessionOptions = {}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthInitializing, setIsAuthInitializing] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const onSessionRef = useRef(options.onSession);
  const onSignedOutRef = useRef(options.onSignedOut);
  const onBeforeSignOutRef = useRef(options.onBeforeSignOut);
  const processedSessionsRef = useRef<Set<string>>(new Set());
  const triggeredCallbacksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onSessionRef.current = options.onSession;
    onSignedOutRef.current = options.onSignedOut;
    onBeforeSignOutRef.current = options.onBeforeSignOut;
  }, [options.onSession, options.onSignedOut, options.onBeforeSignOut]);

  useEffect(() => {
    let disposed = false;

    const resetSessionGuards = () => {
      processedSessionsRef.current.clear();
      triggeredCallbacksRef.current.clear();
    };

    const resolveProfile = async (user: any) => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('[Auth] profile select failed:', error);
          return null;
        }

        if (data) {
          return data;
        }

        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert([{
            id: user.id,
            name: user.user_metadata?.full_name || user.email?.split('@')[0],
            avatar_url: getMetadataAvatar(user.user_metadata),
            gemini_api_key: ''
          }])
          .select()
          .maybeSingle();

        if (insertError) {
          if (insertError.code === '23505') {
            const { data: existingProfile, error: retryError } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', user.id)
              .maybeSingle();
            if (!retryError && existingProfile) {
              return existingProfile;
            }
          }
          console.error('[Auth] profile bootstrap failed:', insertError);
          return null;
        }

        return newProfile || null;
      } catch (error) {
        console.error('[Auth] profile resolve failed:', error);
        return null;
      }
    };

    const applySession = async (session: any, event: AuthEvent, fromBoot = false) => {
      if (disposed) return;

      const sessionKey = `${event}-${session?.user?.id || 'none'}-${session?.access_token?.slice(-10) || 'none'}`;
      if (processedSessionsRef.current.has(sessionKey)) {
        console.log(`[Auth] Skipping already processed session: ${sessionKey}`);
        return;
      }
      processedSessionsRef.current.add(sessionKey);
      // Keep set size manageable
      if (processedSessionsRef.current.size > 20) {
        const first = processedSessionsRef.current.values().next().value;
        if (first) processedSessionsRef.current.delete(first);
      }

      try {
        if (!session?.user) {
          resetSessionGuards();
          if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' || fromBoot) {
            setCurrentUser(null);
            setAuthMode('login');
            if (onSignedOutRef.current) {
              await onSignedOutRef.current();
            }
          }
          return;
        }

        // --- NEW v2.5.3: Set Optimistic User IMMEDIATELY to prevent login screen flicker ---
        const optimisticUser = mapSupabaseUser(session.user, null);
        setCurrentUser(optimisticUser);

        // --- NEW v2.6.0: Trigger onSession callback OPTIMISTICALLY so background fetching starts ASAP ---
        const callbackKey = `${event}-${session.user.id}-${session.access_token?.slice(-10) || 'none'}`;
        if (onSessionRef.current && !triggeredCallbacksRef.current.has(callbackKey)) {
          triggeredCallbacksRef.current.add(callbackKey);
          try {
            onSessionRef.current({
              event,
              user: optimisticUser,
              profile: null,
              session,
            });
          } catch (err) {
            console.error('[Auth] Optimistic onSession failed:', err);
          }
        }

        // 1. Resolve Profile in background WITHOUT awaiting for the sake of init completion
        (async () => {
          const profilePromise = resolveProfile(session.user);
          const profileWithTimeout = Promise.race([
            profilePromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
          ]);

          const profile = await profileWithTimeout;
          if (disposed) return;

          // Update with final data (e.g. name from profile)
          const finalUser = mapSupabaseUser(session.user, profile);
          setCurrentUser(finalUser);
        })();

        // Keep sets clean manageable
        if (triggeredCallbacksRef.current.size > 20) {
          const first = triggeredCallbacksRef.current.values().next().value;
          if (first) triggeredCallbacksRef.current.delete(first);
        }
      } catch (error) {
        console.error('[Auth] applySession failed:', error);
      }
    };

    let initTimer: any;

    const completeInit = () => {
      if (!disposed) {
        setIsAuthInitializing(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] v2.1 onAuthStateChange event:', event, 'session:', session?.user?.id);

      if (event === 'INITIAL_SESSION' && !session) {
        return;
      }

      await applySession(session, event);
      completeInit();
    });

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      console.log('[Auth] Explicit getSession result:', session?.user?.id, error);
      if (!disposed && session) {
        applySession(session, 'INITIAL_SESSION', true).finally(() => {
          setTimeout(completeInit, 100);
        });
      } else if (!disposed && !session) {
        // If no session found explicitly, wait a bit longer for onAuthStateChange
        setTimeout(completeInit, 800);
      }
    });

    // Fallback timer should be longer to ensure we don't flash login screen incorrectly
    initTimer = setTimeout(completeInit, 3000);

    return () => {
      disposed = true;
      clearTimeout(initTimer);
      subscription.unsubscribe();
    };
  }, []);

  const logout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    onBeforeSignOutRef.current?.();

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
      }
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return {
    currentUser,
    setCurrentUser,
    isAuthInitializing,
    authMode,
    setAuthMode,
    isLoggingOut,
    logout,
  };
};
