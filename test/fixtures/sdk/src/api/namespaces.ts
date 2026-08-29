import type { PaymentResult, RequestPaymentParams } from "./types.js";

export interface WalletApi {
  requestPayment(params: RequestPaymentParams): Promise<PaymentResult>;
}

export interface StorageApi {
  get<T>(key: string): Promise<T | null>;
}
