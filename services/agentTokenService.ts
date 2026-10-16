import { supabase } from '../utils/supabase';

export interface AgentToken {
    id: string;
    name: string;
    tokenPrefix: string;
    canWrite: boolean;
    lastUsedAt?: string;
    createdAt: string;
}

export const MAX_AGENT_TOKENS = 5;

export const getMcpServerUrl = (): string => {
    const base = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
    return `${base}/functions/v1/mcp-server`;
};

const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const sha256Hex = async (value: string): Promise<string> =>
    toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

export const listAgentTokens = async (): Promise<AgentToken[]> => {
    const { data, error } = await supabase
        .from('agent_tokens')
        .select('id,name,token_prefix,can_write,last_used_at,created_at')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        tokenPrefix: row.token_prefix,
        canWrite: row.can_write,
        lastUsedAt: row.last_used_at || undefined,
        createdAt: row.created_at,
    }));
};

// The plaintext token is returned once; only its SHA-256 hash is stored.
export const createAgentToken = async (userId: string, name: string, canWrite: boolean): Promise<string> => {
    const token = `dfa_${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const { error } = await supabase.from('agent_tokens').insert([{
        user_id: userId,
        name: name.trim().slice(0, 60),
        token_hash: await sha256Hex(token),
        token_prefix: token.slice(0, 8),
        can_write: canWrite,
    }]);
    if (error) throw error;
    return token;
};

export const revokeAgentToken = async (id: string): Promise<void> => {
    const { error } = await supabase.from('agent_tokens').delete().eq('id', id);
    if (error) throw error;
};
