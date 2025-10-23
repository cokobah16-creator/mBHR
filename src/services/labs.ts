import { supabase } from '../lib/supabase';

export interface LabOrder {
  id?: string;
  patientId: string;
  visitId?: string;
  orderedBy: string;
  testName: string;
  testCode?: string;
  priority: 'routine' | 'urgent' | 'stat';
  status: 'ordered' | 'collected' | 'processing' | 'completed' | 'cancelled';
  specimenType?: string;
  clinicalNotes?: string;
  orderedAt?: Date;
  collectedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}

export interface LabResult {
  id?: string;
  orderId: string;
  resultValue: string;
  resultUnit?: string;
  referenceRange?: string;
  interpretation: 'normal' | 'abnormal' | 'critical';
  resultDate: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  notes?: string;
}

export async function createLabOrder(order: LabOrder): Promise<string> {
  const { data, error } = await supabase
    .from('lab_orders')
    .insert({
      patient_id: order.patientId,
      visit_id: order.visitId,
      ordered_by: order.orderedBy,
      test_name: order.testName,
      test_code: order.testCode,
      priority: order.priority,
      status: 'ordered',
      specimen_type: order.specimenType,
      clinical_notes: order.clinicalNotes,
    })
    .select()
    .single();

  if (error) throw error;
  return data.id;
}

export async function updateLabOrderStatus(
  orderId: string,
  status: LabOrder['status']
): Promise<void> {
  const updates: any = { status };

  if (status === 'collected') {
    updates.collected_at = new Date().toISOString();
  } else if (status === 'completed') {
    updates.completed_at = new Date().toISOString();
  } else if (status === 'cancelled') {
    updates.cancelled_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('lab_orders')
    .update(updates)
    .eq('id', orderId);

  if (error) throw error;
}

export async function addLabResult(result: LabResult): Promise<string> {
  const { data, error } = await supabase
    .from('lab_results')
    .insert({
      order_id: result.orderId,
      result_value: result.resultValue,
      result_unit: result.resultUnit,
      reference_range: result.referenceRange,
      interpretation: result.interpretation,
      result_date: result.resultDate.toISOString(),
      notes: result.notes,
    })
    .select()
    .single();

  if (error) throw error;

  await updateLabOrderStatus(result.orderId, 'completed');

  return data.id;
}

export async function reviewLabResult(
  resultId: string,
  reviewedBy: string
): Promise<void> {
  const { error } = await supabase
    .from('lab_results')
    .update({
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', resultId);

  if (error) throw error;
}

export async function getPatientLabOrders(patientId: string): Promise<LabOrder[]> {
  const { data, error } = await supabase
    .from('lab_orders')
    .select('*')
    .eq('patient_id', patientId)
    .order('ordered_at', { ascending: false });

  if (error) throw error;

  return data.map(o => ({
    id: o.id,
    patientId: o.patient_id,
    visitId: o.visit_id,
    orderedBy: o.ordered_by,
    testName: o.test_name,
    testCode: o.test_code,
    priority: o.priority,
    status: o.status,
    specimenType: o.specimen_type,
    clinicalNotes: o.clinical_notes,
    orderedAt: o.ordered_at ? new Date(o.ordered_at) : undefined,
    collectedAt: o.collected_at ? new Date(o.collected_at) : undefined,
    completedAt: o.completed_at ? new Date(o.completed_at) : undefined,
    cancelledAt: o.cancelled_at ? new Date(o.cancelled_at) : undefined,
  }));
}

export async function getLabResults(orderId: string): Promise<LabResult[]> {
  const { data, error } = await supabase
    .from('lab_results')
    .select('*')
    .eq('order_id', orderId)
    .order('result_date', { ascending: false });

  if (error) throw error;

  return data.map(r => ({
    id: r.id,
    orderId: r.order_id,
    resultValue: r.result_value,
    resultUnit: r.result_unit,
    referenceRange: r.reference_range,
    interpretation: r.interpretation,
    resultDate: new Date(r.result_date),
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : undefined,
    notes: r.notes,
  }));
}

export async function getPendingLabOrders(): Promise<LabOrder[]> {
  const { data, error } = await supabase
    .from('lab_orders')
    .select('*')
    .in('status', ['ordered', 'collected', 'processing'])
    .order('priority', { ascending: true })
    .order('ordered_at', { ascending: true });

  if (error) throw error;

  return data.map(o => ({
    id: o.id,
    patientId: o.patient_id,
    visitId: o.visit_id,
    orderedBy: o.ordered_by,
    testName: o.test_name,
    testCode: o.test_code,
    priority: o.priority,
    status: o.status,
    specimenType: o.specimen_type,
    clinicalNotes: o.clinical_notes,
    orderedAt: o.ordered_at ? new Date(o.ordered_at) : undefined,
    collectedAt: o.collected_at ? new Date(o.collected_at) : undefined,
  }));
}

export async function getCriticalResults(): Promise<Array<LabResult & { patientId: string; testName: string }>> {
  const { data, error } = await supabase
    .from('lab_results')
    .select(`
      *,
      lab_orders!inner(patient_id, test_name)
    `)
    .eq('interpretation', 'critical')
    .is('reviewed_at', null)
    .order('result_date', { ascending: false });

  if (error) throw error;

  return data.map((r: any) => ({
    id: r.id,
    orderId: r.order_id,
    resultValue: r.result_value,
    resultUnit: r.result_unit,
    referenceRange: r.reference_range,
    interpretation: r.interpretation,
    resultDate: new Date(r.result_date),
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : undefined,
    notes: r.notes,
    patientId: r.lab_orders.patient_id,
    testName: r.lab_orders.test_name,
  }));
}
