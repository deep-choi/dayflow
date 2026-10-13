import { supabase } from '../utils/supabase';
import { Browser } from '@capacitor/browser';
import { isNativeApp } from '../utils/nativeAuth';

export async function submitAppSupport(action: 'ai-report' | 'account-deletion', content = '', reason = ''): Promise<string> {
    const { data, error } = await supabase.functions.invoke<{ message: string }>('app-support', { body: { action, content, reason } });
    if (error) throw new Error('접수하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    if (!data?.message) throw new Error('접수 결과를 확인하지 못했습니다.');
    return data.message;
}

export async function openServicePage(route: 'privacy' | 'account-deletion') {
    const url = `https://dayflow.web.app/${route}/`;
    if (isNativeApp()) await Browser.open({ url });
    else window.open(url, '_blank', 'noopener,noreferrer');
}
