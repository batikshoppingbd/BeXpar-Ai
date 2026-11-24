export interface AppSettings {
  app_name: string;
  logo_url?: string;
  icon_url?: string;
  default_theme: 'light' | 'dark';
  primary_color: string;
  secondary_color: string;
  default_language: 'bn' | 'en';
  maintenance_mode: boolean;
  registration_enabled: boolean;
  support_email?: string;
  support_phone?: string;
  terms_url?: string;
  privacy_url?: string;
  announcement?: string;
}

export interface SystemStatus {
  supabaseConnected: boolean;
  schemaReady: boolean;
  appliedMigrations: string[];
  schemaError?: string;
  bootstrapNeeded: boolean;
  supabase: {
    configured: boolean;
    url: string;
    anonKey: string;
  };
  appSettings: AppSettings;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  avatar_url?: string;
  role: 'super_admin' | 'business_owner' | 'business_admin' | 'business_staff' | 'support_staff';
  status: 'active' | 'inactive' | 'suspended';
  language: 'bn' | 'en';
  timezone: string;
  created_at?: string;
}

export interface SubscriptionPlan {
  id: string;
  slug: string;
  name: string;
  description: string;
  monthly_price: number;
  yearly_price: number;
  currency: string;
  coin_allocation: number;
  max_products: number;
  max_staff: number;
  max_channels: number;
  ai_usage_limit: number;
  allowed_features: string[];
  duration_days: number;
  is_active: boolean;
  display_order: number;
}

export interface CoinPackage {
  id: string;
  name: string;
  coin_amount: number;
  bonus_coins: number;
  price: number;
  currency: string;
  validity_days: number;
  description: string;
  status?: string;
  display_order: number;
}

export interface Business {
  id: string;
  owner_id: string;
  name: string;
  owner_name: string;
  email: string;
  phone: string;
  category: string;
  address: string;
  logo_url?: string;
  facebook_info?: Record<string, string>;
  instagram_info?: Record<string, string>;
  whatsapp_info?: Record<string, string>;
  status: 'active' | 'inactive' | 'suspended';
  subscription_plan_id?: string;
  subscription_plan?: SubscriptionPlan;
  subscription_status: string;
  subscription_expires_at?: string;
  memberRole?: string;
  memberPermissions?: Record<string, boolean>;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  sku: string;
  description: string;
  regular_price: number;
  discount_price: number | null;
  purchase_cost: number;
  stock_quantity: number;
  low_stock_threshold: number;
  category_name: string;
  colors: string[];
  sizes: string[];
  status: 'active' | 'draft' | 'out_of_stock';
  is_featured: boolean;
  primary_image_url: string;
  images?: Array<{ id: string; image_url: string; display_order: number }>;
  created_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  tags: string[];
  notes: string;
  segment: string;
  total_orders: number;
  total_spent: number;
  cancelled_orders: number;
  returned_orders: number;
  last_order_at?: string;
  created_at: string;
}

export interface OrderItem {
  id: string;
  product_id?: string;
  product_name: string;
  sku: string;
  variant_color: string;
  variant_size: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  total_price: number;
}

export interface Order {
  id: string;
  business_id: string;
  order_number: string;
  customer_id?: string;
  conversation_id?: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  subtotal: number;
  discount: number;
  delivery_charge: number;
  total_amount: number;
  payment_method: string;
  payment_status: 'unpaid' | 'paid' | 'partial' | 'refunded';
  order_status: 'pending' | 'confirmed' | 'processing' | 'ready_to_ship' | 'shipped' | 'delivered' | 'cancelled' | 'returned' | 'refunded';
  order_source: 'facebook' | 'instagram' | 'whatsapp' | 'manual' | 'ai_agent';
  courier_name?: string;
  tracking_id?: string;
  risk_level: 'low' | 'medium' | 'high';
  risk_reasons: string[];
  risk_notes?: string;
  notes?: string;
  items?: OrderItem[];
  history?: Array<{ id: string; old_status: string; new_status: string; note: string; created_at: string }>;
  shipments?: Array<{ id: string; provider: string; tracking_id: string; parcel_status: string; created_at: string }>;
  created_at: string;
}

export interface Conversation {
  id: string;
  business_id: string;
  customer_id?: string;
  channel: 'facebook' | 'instagram' | 'whatsapp' | 'web_test';
  external_thread_id: string;
  customer_name: string;
  customer_avatar?: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  status: 'open' | 'resolved' | 'archived';
  ai_enabled: boolean;
  assigned_staff_id?: string | null;
  tags: string[];
  internal_notes: string;
  customer?: Customer;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_type: 'customer' | 'ai' | 'staff' | 'system';
  sender_id?: string;
  content: string;
  message_type: 'text' | 'image' | 'attachment' | 'order_summary';
  delivery_status: 'sent' | 'delivered' | 'read' | 'failed';
  metadata?: Record<string, unknown>;
  attachments?: Array<{ id: string; file_url: string; file_type: string }>;
  created_at: string;
}
