 

export type CustomerInfo = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  address2?: string;
  city: string;
  country: string;
  countryCode: string;
  province?: string;
  provinceName?: string;
  zip?: string;
  addresses: ShopifyAddress[];
};

export interface CartItem {
  product_title: string;
  quantity: number;
  shop_currency?: string;
  compare_at_price?: number;
  image?: string;
  variant_id?: string;
  sku?: string;
  original_price: number;
  line_total_discount?: number;
  line_discount_titles?: string[];
  product_id?: string | number;
  collection_ids?: number[];
  variant_title?: string | null;
}

export interface ShopifyAddress {
  id: string;
  name: string;
  phone?: string;
  email: string;
  address1: string;
  address2?: string;
  city: string;
  country: string;
  is_default: boolean;
  province?: string;
  zip?: string;
}
 

 