import { BillingStatus, TenantPlan } from '../../domain/enums';

export type BillingSubscriptionDto = {
  tenantId: string;
  plan: TenantPlan;
  status: BillingStatus;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  canOpenCustomerPortal: boolean;
};

export type BillingCheckoutSessionCreateRequestDto = {
  plan?: unknown;
  successUrl?: unknown;
  cancelUrl?: unknown;
};

export type BillingCheckoutSessionDto = {
  sessionId: string;
  checkoutUrl: string;
};

export type BillingCustomerPortalSessionCreateRequestDto = {
  returnUrl?: unknown;
};

export type BillingCustomerPortalSessionDto = {
  portalUrl: string;
};
