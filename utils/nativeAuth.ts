import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase';

export const NATIVE_AUTH_REDIRECT_URL = 'com.deepchoi.dayflow://auth/callback';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

export const getAuthRedirectUrl = (): string => (
    isNativeApp() ? NATIVE_AUTH_REDIRECT_URL : `${window.location.origin}/`
);

const saveNativeAuthError = (message: string) => {
    try {
        window.sessionStorage.setItem('dayflow-native-auth-error', message);
    } catch {
        // Ignore storage failures and let the auth view show its fallback state.
    }
};

const handleNativeAuthUrl = async (url: string) => {
    const callbackUrl = new URL(url);
    const queryParams = new URLSearchParams(callbackUrl.search);
    const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ''));
    const errorDescription = queryParams.get('error_description') || hashParams.get('error_description');

    if (errorDescription) {
        saveNativeAuthError(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
        await Browser.close().catch(() => undefined);
        return;
    }

    const code = queryParams.get('code');
    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) saveNativeAuthError(error.message);
        await Browser.close().catch(() => undefined);
        return;
    }

    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
        if (error) saveNativeAuthError(error.message);
    }

    await Browser.close().catch(() => undefined);
};

export const initializeNativeAuthRedirect = async (): Promise<void> => {
    if (!isNativeApp()) return;

    await App.addListener('appUrlOpen', ({ url }) => {
        void handleNativeAuthUrl(url);
    });

    const launchUrl = await App.getLaunchUrl();
    if (launchUrl?.url) await handleNativeAuthUrl(launchUrl.url);
};

export const startGoogleSignIn = async (): Promise<void> => {
    const native = isNativeApp();
    if (!native && /^\/admin(?:\/|$)/u.test(window.location.pathname)) {
        try { window.sessionStorage.setItem('dayflow-admin-auth-return', String(Date.now())); } catch { /* Storage can be unavailable. */ }
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: getAuthRedirectUrl(),
            skipBrowserRedirect: native,
        },
    });

    if (error) throw error;
    if (native && data.url) await Browser.open({ url: data.url });
};
