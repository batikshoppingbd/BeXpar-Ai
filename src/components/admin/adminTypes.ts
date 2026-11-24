export type AdminSectionId =
  | 'dashboard'
  | 'users'
  | 'packages'
  | 'ai'
  | 'settings'
  | 'customization'
  | 'analytics'
  | 'logs'
  | 'notifications'
  | 'security'
  | 'backup'
  | 'help';

export type DateRangePreset = '7d' | '30d' | '3m' | '1y' | 'custom';

export interface AdminDashboardPayload {
  range: string;
  stats: {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    suspendedUsers: number;
    totalBusinesses: number;
    activeBusinesses: number;
    suspendedBusinesses: number;
    inactiveBusinesses: number;
    totalOrders: number;
    totalAiRequests: number;
    totalTokensUsed: number;
    totalCoinsSold: number;
    totalCoinsConsumed: number;
    estimatedProviderCostUsd: number;
    subscriptionRevenue: number;
    coinPackageRevenue: number;
    totalRevenue: number;
    pendingPaymentsCount: number;
    usersGrowthPct: number | null;
    businessesGrowthPct: number | null;
    coinsGrowthPct: number | null;
    revenueGrowthPct: number | null;
  };
  series: Array<{
    date: string;
    users: number;
    businesses: number;
    revenue: number;
    coinsSold: number;
    subscriptions: number;
  }>;
  businessDistribution: {
    active: number;
    suspended: number;
    inactive: number;
  };
  recentRegistrations: Array<{
    id: string;
    email: string;
    full_name: string;
    role: string;
    status: string;
    created_at: string;
  }>;
  recentBusinesses: Array<{
    id: string;
    name: string;
    owner_name: string;
    email: string;
    category: string;
    status: string;
    subscription_status: string;
    created_at: string;
    subscription_plan?: { name: string; slug: string } | null;
  }>;
  recentTransactions: Array<{
    id: string;
    business_id: string;
    type: string;
    amount: number;
    balance_after: number;
    description: string;
    created_at: string;
    business?: { id: string; name: string } | null;
  }>;
  systemActivity: Array<{
    id: string;
    actor_email: string;
    action: string;
    target_type: string;
    target_id: string;
    details: Record<string, unknown>;
    created_at: string;
  }>;
  supabaseHealth: {
    connected: boolean;
    schemaReady: boolean;
    appliedMigrations: string[];
  };
  serverMeta: {
    uptimeSeconds: number;
    nodeVersion: string;
    checkedAt: string;
  };
}

export interface AdminUserRecord {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: string;
  status: string;
  language?: string;
  timezone?: string;
  created_at: string;
}

export interface AdminBusinessRecord {
  id: string;
  owner_id: string;
  name: string;
  owner_name: string;
  email: string;
  phone: string;
  category: string;
  address: string;
  status: string;
  subscription_plan_id?: string | null;
  subscription_plan?: { id: string; name: string; slug: string } | null;
  subscription_status: string;
  subscription_expires_at?: string | null;
  created_at: string;
  wallet: {
    balance: number;
    total_purchased: number;
    total_used: number;
    total_bonus: number;
  };
  ordersCount?: number;
  productsCount?: number;
}

export interface AdminAiProvider {
  id: string;
  slug: string;
  name: string;
  provider_type: 'gemini' | 'openai' | 'deepseek' | 'custom';
  base_url: string;
  is_active: boolean;
  priority: number;
  updated_at?: string;
  has_api_key: boolean;
}

export interface AdminAiModel {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  is_fallback: boolean;
  priority: number;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
  coins_per_usd: number;
  max_tokens: number;
  min_plan_slug: string;
  provider?: { id: string; slug: string; name: string };
}

export interface AdminAnalyticsPayload {
  range: string;
  summary: {
    periodRevenue: number;
    periodSubRevenue: number;
    periodCoinRevenue: number;
    periodOrders: number;
    periodGmv: number;
    periodAiRequests: number;
    periodTokens: number;
    periodAiCostUsd: number;
    periodCoinsUsed: number;
    totalBusinesses: number;
    activeBusinesses: number;
  };
  timeSeries: Array<{
    date: string;
    revenue: number;
    orders: number;
    users: number;
    businesses: number;
    aiRequests: number;
    coinsUsed: number;
  }>;
  businessByCategory: Array<{ category: string; count: number }>;
  planDistribution: Array<{ planName: string; count: number }>;
  aiProviderUsage: Array<{
    providerSlug: string;
    requests: number;
    tokens: number;
    coinsUsed: number;
    costUsd: number;
  }>;
  topBusinesses: Array<{
    id: string;
    name: string;
    category: string;
    status: string;
    orders: number;
    gmv: number;
    aiCoinsUsed: number;
  }>;
}
