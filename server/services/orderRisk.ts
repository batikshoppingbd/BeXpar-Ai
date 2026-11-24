import { getSupabaseAdmin } from '../config/supabaseConfig.ts';
import { checkSteadfastFraudByPhone, normalizeBdPhone, type CourierFraudStats } from './courierService.ts';

export interface RiskEvaluation {
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
  courierStats?: CourierFraudStats;
}

export async function evaluateOrderRisk(params: {
  businessId: string;
  customerPhone: string;
  totalAmount: number;
  excludeOrderId?: string;
}): Promise<RiskEvaluation> {
  const admin = getSupabaseAdmin();
  const reasons: string[] = [];
  let score = 0;

  const cleanPhone = (params.customerPhone || '').replace(/\s+/g, '');
  const normalizedPhone = normalizeBdPhone(cleanPhone);

  if (!cleanPhone || normalizedPhone.length < 10) {
    score += 3;
    reasons.push('Invalid or incomplete phone number format');
  }

  // Run local order history lookup and Steadfast network fraud check in parallel
  const [priorRes, courierStats] = await Promise.all([
    cleanPhone
      ? admin
          .from('orders')
          .select('id, order_status, created_at, total_amount')
          .eq('business_id', params.businessId)
          .or(`customer_phone.eq.${cleanPhone},customer_phone.eq.${normalizedPhone}`)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as Array<{ id: string; order_status: string; created_at: string; total_amount: number }> }),
    checkSteadfastFraudByPhone(params.businessId, cleanPhone),
  ]);

  const priorOrders = (priorRes.data || []).filter((o) => !params.excludeOrderId || o.id !== params.excludeOrderId);

  if (priorOrders.length > 0) {
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
      reasons.push(`Store history: ${cancelledCount} cancelled orders on this number`);
    } else if (cancelledCount === 1) {
      score += 1;
      reasons.push('Store history: 1 previously cancelled order');
    }

    if (returnedCount >= 1) {
      score += 3;
      reasons.push(`Store history: ${returnedCount} returned order(s)`);
    }

    if (deliveredCount >= 2 && cancelledCount === 0 && returnedCount === 0) {
      score = Math.max(0, score - 2);
      reasons.push(`Verified repeat store customer (${deliveredCount} delivered)`);
    }
  }

  if (courierStats.checked) {
    if (courierStats.totalParcels === 0) {
      reasons.push('Steadfast Auto-Detection: 0 prior parcels (New courier recipient)');
    } else {
      const rateLabel = courierStats.successRate !== null ? ` (${courierStats.successRate}% delivery success)` : '';
      reasons.push(
        `Steadfast Auto-Detection: ${courierStats.totalParcels} parcels · ${courierStats.totalDelivered} delivered · ${courierStats.totalCancelled} cancelled${rateLabel}`
      );

      if (courierStats.totalCancelled >= 3 && (courierStats.successRate ?? 100) < 60) {
        score += 4;
      } else if (courierStats.totalCancelled >= 2 && (courierStats.successRate ?? 100) < 75) {
        score += 2;
      } else if (courierStats.totalDelivered >= 3 && (courierStats.successRate ?? 0) >= 85) {
        score = Math.max(0, score - 1);
      }
    }
  } else if (reasons.length === 0) {
    reasons.push('Local Auto-Detection: Phone format valid · No prior duplicate or return flags');
  }

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (score >= 4) riskLevel = 'high';
  else if (score >= 2) riskLevel = 'medium';

  return { riskLevel, reasons, courierStats };
}
