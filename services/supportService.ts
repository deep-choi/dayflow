import { supabase } from '../utils/supabase';

export type SupportCategory = 'service' | 'account' | 'billing' | 'ai' | 'other';

export type SupportTicket = {
  id: string;
  category: SupportCategory;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_role: 'user' | 'admin';
  message: string;
  created_at: string;
};

const readError = async (error: unknown): Promise<string> => {
  const context = (error as { context?: unknown })?.context;
  if (!(context instanceof Response)) return '고객지원 요청을 처리하지 못했습니다.';
  try {
    const body = await context.clone().json() as { message?: unknown };
    return typeof body.message === 'string' ? body.message : '고객지원 요청을 처리하지 못했습니다.';
  } catch {
    return '고객지원 요청을 처리하지 못했습니다.';
  }
};

export const createSupportTicket = async (input: { category: SupportCategory; subject: string; message: string }): Promise<void> => {
  const { error } = await supabase.functions.invoke('support-ticket', { body: { action: 'create', ...input } });
  if (error) throw new Error(await readError(error));
};

export const getMySupportTickets = async (): Promise<{ tickets: SupportTicket[]; messages: SupportMessage[] }> => {
  const { data, error } = await supabase.functions.invoke<{ tickets: SupportTicket[]; messages: SupportMessage[] }>('support-ticket', { body: { action: 'list' } });
  if (error) throw new Error(await readError(error));
  return data || { tickets: [], messages: [] };
};

export const replyToSupportTicket = async (ticketId: string, message: string): Promise<void> => {
  const { error } = await supabase.functions.invoke('support-ticket', { body: { action: 'reply', ticketId, message } });
  if (error) throw new Error(await readError(error));
};
