import { getSupabaseAdmin } from '../config/supabaseConfig.ts';

export interface RiskEvaluation {
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
}

export async function evaluateOrderRisk(params: {
  businessId: string;
  customerPhone: string;
  totalAmount: number;
}): Promise<RiskEvaluation> {
  const admin = getSupabaseAdmin();
  const reasons: string[] = [];
  let score = 0;

  const cleanPhone = (params.customerPhone || '').replace(/\s+/g, '');
  if (!cleanPhone || cleanPhone.length < 8) {
    score += 3;
    reasons.push('Invalid or incomplete phone number format');
  }

  if (cleanPhone) {
    const { data: priorOrders } = await admin
      .from('orders')
      .select('id, order_status, created_at, total_amount')
      .eq('business_id', params.businessId)
      .eq('customer_phone', cleanPhone)
      .order('created_at', { ascending: false })
      .limit(20);

    if (priorOrders && priorOrders.length > 0) {
      const recent15Min = priorOrders.filter(
        (o) => Date.now() - new Date(o.created_at).getTime() < 15 * 60 * 1000
      );
      if (recent15Min.length >= 1) {
        score += 2;
        reasons.push(`Repeated order attempt within 15 minutes (${recent15Min.length} prior)`);
      }

      const cancelledCount = priorOrders.filter((o) => o.order_status === 'cancelled').length;
      const returnedCount = priorOrders.filter((o) => o.order_status === 'returned').length;
      const deliveredCount = priorOrders.filter((o) => o.order_status === 'delivered').length;

      if (cancelledCount >= 2) {
        score += 3;
        reasons.push(`High cancellation history (${cancelledCount} cancelled orders)`);
      } else if (cancelledCount === 1) {
        score += 1;
        reasons.push('1 previously cancelled order on this number');
      }

      if (returnedCount >= 1) {
        score += 3;
        reasons.push(`Previous return history (${returnedCount} returned orders)`);
      }

      if (deliveredCount >= 2 && cancelledCount === 0 && returnedCount === 0) {
        score = Math.max(0, score - 2);
        reasons.push(`Verified repeat customer (${deliveredCount} delivered orders)`);
      }
    }
  }

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (score >= 4) riskLevel = 'high';
  else if (score >= 2) riskLevel = 'medium';

  return { riskLevel, reasons };
}
