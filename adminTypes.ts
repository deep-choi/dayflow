export interface AdminSettings {
  revision: number;
  trial_paused: boolean;
  guest_ip_daily_limit: number;
  guest_global_daily_limit: number;
}
export interface AdminMember {
  id: string; email: string; name: string; joinedAt: string; lastSignInAt: string | null;
  adminRole: string; bannedUntil: string | null; planId: string; subscriptionStatus: string;
  aiUsed: number; aiLimit: number; aiRemaining: number; noteCount: number;
  trialUsed: number; trialLimit: number;
}
export interface SupportTicket {
  id: string; user_id: string; category: string; subject: string; status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: string; created_at: string; updated_at: string;
}
export interface AdminDashboard {
  generatedAt: string;
  summary: { totalUsers: number; activeEntitlements: number; monthlyGrossRevenue: number; monthlyRefunds: number; monthlyNetRevenue: number;
    aiRequests: number; aiRequests30d: number; aiFailures30d: number; aiTokens30d: number; aiAverageDurationMs30d: number; openSupportTickets: number };
  members: AdminMember[];
  payments: Array<{ id: string; user_id: string; toss_order_id: string; plan_id: string; amount: number; currency: string; status: string; created_at: string; refundedAmount: number; refundableAmount: number }>;
  refunds: Array<{ id: string; payment_id: string; user_id: string; amount: number; reason: string; status: string; created_at: string }>;
  support: { tickets: SupportTicket[]; messages: Array<{ id: string; ticket_id: string; sender_role: string; message: string; created_at: string }> };
  ai: { modelBreakdown: Array<{ model: string; requests: number; failures: number; totalTokens: number; averageDurationMs: number }>;
    recentEvents: Array<{ id: string; model: string; status: string; error_code: string | null; created_at: string; duration_ms: number }> };
  audits: Array<{ id: string; adminEmail: string; action: string; target_type: string; target_id: string | null; reason: string | null; metadata: unknown; created_at: string }>;
  notes: Array<{ id: string; user_id: string; adminEmail: string; note: string; created_at: string }>;
  system: { configuration: { billingEnabled: boolean; billingMode: string; tossKeyMode: string; billingCronSecretConfigured: boolean; tossWebhookTokenConfigured: boolean } };
}
