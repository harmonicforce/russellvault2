const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = params
    ? '?' + new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return request<T>(`${path}${qs}`);
}

export function post<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function patch<T>(path: string, body: any): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InventoryLot {
  inventory_lot_id: string;
  sellable_sku: string;
  reserved_child_id: string | null;
  active_child_id: string | null;
  record_origin: string | null;
  intake_status: string | null;
  date_received: string | null;
  acquisition_source: string | null;
  business_vertical: string | null;
  category: string | null;
  product_name: string | null;
  variant_model_set: string | null;
  featured_subject: string | null;
  card_number: string | null;
  language: string | null;
  quantity: number;
  tracking_mode: string | null;
  condition_or_quality: string | null;
  condition_reviewed: string | null;
  grading_company: string | null;
  numeric_grade: string | null;
  grade_designation: string | null;
  certification_number: string | null;
  shoe_size: string | null;
  apparel_size: string | null;
  color: string | null;
  serial_number: string | null;
  product_format: string | null;
  seal_or_packaging_condition: string | null;
  physical_reference: string | null;
  location_code: string | null;
  recorded_unit_value: number | null;
  owner_notes: string | null;
  confirmed_cost_basis: number;
  cost_status: string;
  confirmed_allocated_quantity: number;
  listing_status: string;
  sold_quantity: number;
  available_quantity: number;
  row_readiness: string | null;
}

export interface WhatnotPurchase {
  acquisition_line_id: string;
  order_id: string | null;
  processed_date: string | null;
  seller: string | null;
  business_vertical: string | null;
  product_name: string | null;
  reference_number: string | null;
  quantity_purchased: number;
  total_paid: number;
  unit_cost: number;
  order_status: string | null;
  confirmed_allocated_quantity: number;
  remaining_quantity: number;
  confirmed_allocated_cost: number;
  remaining_cost: number;
  reconciliation_status: string;
  product_type: string | null;
}

export type ProductType =
  | 'Slab' | 'Single' | 'Sealed'
  | 'Sneakers' | 'Apparel' | 'Accessories' | 'Electronics' | 'Collectibles' | 'Other'
  | 'Unreviewed';

export interface TypeSummary {
  order: ProductType[];
  byType: Record<string, { product_type: string; lines: number; total: number }>;
  grandTotal: number;
  grandLines: number;
}

export interface CostLink {
  allocation_id: string;
  inventory_lot_id: string;
  inventory_product: string | null;
  inventory_quantity: number;
  acquisition_line_id: string;
  purchase_product: string | null;
  seller: string | null;
  purchase_date: string | null;
  purchase_quantity: number;
  purchase_total: number;
  allocated_quantity: number;
  allocated_cost: number;
  allocation_status: string;
  match_confidence: string | null;
  match_method: string | null;
  owner_notes: string | null;
  created_at: string;
}

export interface EbayListing {
  listing_id: string;
  inventory_lot_id: string;
  sellable_sku: string | null;
  product_name: string | null;
  available_quantity: number;
  quantity_to_list: number;
  listing_title: string | null;
  condition_or_item_state: string | null;
  list_price: number | null;
  minimum_acceptable_price: number | null;
  photos_complete: string | null;
  listing_format: string | null;
  listing_status: string;
  listed_date: string | null;
  ebay_item_id: string | null;
  listing_url: string | null;
  owner_notes: string | null;
}

export interface Sale {
  sale_id: string;
  listing_id: string | null;
  inventory_lot_id: string;
  sellable_sku: string | null;
  product_name: string | null;
  ebay_order_id: string | null;
  sold_date: string | null;
  quantity_sold: number;
  gross_item_price: number;
  shipping_charged: number;
  sales_tax_collected: number;
  ebay_fees: number;
  promotion_fees: number;
  shipping_label_cost: number;
  refund_amount: number;
  other_expense: number;
  net_proceeds: number;
  known_cost_basis_applied: number;
  profit_after_known_costs: number | null;
  profit_status: string;
  payment_status: string;
  fulfillment_status: string;
  tracking_number: string | null;
  delivered_date: string | null;
  return_status: string | null;
  owner_notes: string | null;
}

export interface Lookups {
  [key: string]: string[];
}

export interface HealthStatus {
  ok: boolean;
  readOnly: boolean;
}
