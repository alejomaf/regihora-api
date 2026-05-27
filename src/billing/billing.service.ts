import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import StripeConstructor from 'stripe';
import type { Stripe } from 'stripe';
import { Repository } from 'typeorm';

import { EnvironmentVariables } from '../config/environment.validation';
import { TenantEntity } from '../database/entities/tenant.entity';
import { BillingStatus, TenantPlan } from '../domain/enums';
import {
  BillingCheckoutSessionCreateRequestDto,
  BillingCheckoutSessionDto,
  BillingCustomerPortalSessionCreateRequestDto,
  BillingCustomerPortalSessionDto,
  BillingSubscriptionDto,
} from './dto/billing.dto';

type BillingPrincipal = {
  email: string;
  sub: string;
};

type StripeEvent = ReturnType<Stripe['webhooks']['constructEvent']>;
type StripeMetadata = Record<string, string> | null;
type StripeCheckoutSessionLike = {
  id: string;
  customer: string | { id: string } | null;
  metadata: StripeMetadata;
  subscription: string | { id: string } | null;
};
type StripeSubscriptionLike = {
  id: string;
  customer: string | { id: string } | null;
  items: {
    data: Array<{
      current_period_end?: number;
      price: {
        id: string;
      };
    }>;
  };
  metadata: StripeMetadata;
  status: string;
  trial_end: number | null;
};

const paidPlans = [TenantPlan.ESSENTIAL, TenantPlan.PRO, TenantPlan.BUSINESS] as const;
type PaidTenantPlan = (typeof paidPlans)[number];

@Injectable()
export class BillingService {
  private stripeClient: Stripe | null = null;

  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async getSubscription(tenantId: string): Promise<BillingSubscriptionDto> {
    return toBillingSubscriptionDto(await this.getTenantOrFail(tenantId));
  }

  async createCheckoutSession(
    tenantId: string,
    auth: BillingPrincipal,
    request: BillingCheckoutSessionCreateRequestDto,
  ): Promise<BillingCheckoutSessionDto> {
    const tenant = await this.getTenantOrFail(tenantId);
    const plan = parsePaidPlan(request.plan);
    const priceId = this.getPriceId(plan);
    const customerId = await this.ensureStripeCustomer(tenant, auth);
    const stripe = this.getStripe();
    const session = await stripe.checkout.sessions.create({
      allow_promotion_codes: true,
      cancel_url: parseUrl(request.cancelUrl, 'cancelUrl'),
      client_reference_id: tenant.id,
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      metadata: {
        plan,
        tenantId: tenant.id,
      },
      mode: 'subscription',
      subscription_data: {
        metadata: {
          plan,
          tenantId: tenant.id,
        },
      },
      success_url: parseUrl(request.successUrl, 'successUrl'),
    });

    if (session.url === null) {
      throw new ServiceUnavailableException('Stripe did not return a checkout URL.');
    }

    tenant.billingStatus = BillingStatus.CHECKOUT_REQUIRED;
    tenant.stripePriceId = priceId;
    await this.tenantRepository.save(tenant);

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  }

  async createCustomerPortalSession(
    tenantId: string,
    request: BillingCustomerPortalSessionCreateRequestDto,
  ): Promise<BillingCustomerPortalSessionDto> {
    const tenant = await this.getTenantOrFail(tenantId);

    if (tenant.stripeCustomerId === null) {
      throw new BadRequestException('No Stripe customer exists for this tenant yet.');
    }

    const session = await this.getStripe().billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: parseUrl(request.returnUrl, 'returnUrl'),
    });

    return {
      portalUrl: session.url,
    };
  }

  async handleStripeWebhook(signature: string | undefined, rawBody: Buffer): Promise<void> {
    if (signature === undefined || signature.trim().length === 0) {
      throw new BadRequestException('Stripe-Signature header is required.');
    }

    const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET', {
      infer: true,
    });

    if (webhookSecret === null) {
      throw new ServiceUnavailableException('Stripe webhook secret is not configured.');
    }

    let event: StripeEvent;

    try {
      event = this.getStripe().webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch {
      throw new BadRequestException('Stripe webhook signature is invalid.');
    }

    if (event.type === 'checkout.session.completed') {
      await this.syncCheckoutSession(event.data.object);
      return;
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await this.syncSubscription(event.data.object);
    }
  }

  private async syncCheckoutSession(session: StripeCheckoutSessionLike): Promise<void> {
    const tenantId = getMetadataValue(session.metadata, 'tenantId');

    if (tenantId === null) {
      return;
    }

    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });

    if (tenant === null) {
      return;
    }

    tenant.stripeCustomerId = getStringId(session.customer) ?? tenant.stripeCustomerId;
    tenant.stripeSubscriptionId =
      getStringId(session.subscription) ?? tenant.stripeSubscriptionId;

    const plan = parseStripePlan(getMetadataValue(session.metadata, 'plan'));

    if (plan !== null) {
      tenant.plan = plan;
    }

    await this.tenantRepository.save(tenant);

    if (tenant.stripeSubscriptionId !== null) {
      const subscription = await this.getStripe().subscriptions.retrieve(
        tenant.stripeSubscriptionId,
      );
      await this.syncSubscription(subscription);
    }
  }

  private async syncSubscription(subscription: StripeSubscriptionLike): Promise<void> {
    const tenantId = getMetadataValue(subscription.metadata, 'tenantId');
    const tenant = await this.findTenantForSubscription(subscription, tenantId);

    if (tenant === null) {
      return;
    }

    const priceId = subscription.items.data[0]?.price.id ?? null;
    const plan = this.getPlanForPriceId(priceId) ?? parseStripePlan(
      getMetadataValue(subscription.metadata, 'plan'),
    );
    const billingStatus = mapStripeSubscriptionStatus(subscription.status);

    tenant.billingStatus = billingStatus;
    tenant.stripeCustomerId = getStringId(subscription.customer) ?? tenant.stripeCustomerId;
    tenant.stripeSubscriptionId = subscription.id;
    tenant.stripePriceId = priceId;
    tenant.billingCurrentPeriodEnd = getCurrentPeriodEnd(subscription);
    tenant.trialEndsAt = toDateOrNull(subscription.trial_end);

    if (billingStatus === BillingStatus.CANCELED || billingStatus === BillingStatus.UNPAID) {
      tenant.plan = TenantPlan.FREE;
    } else if (plan !== null) {
      tenant.plan = plan;
    }

    await this.tenantRepository.save(tenant);
  }

  private async findTenantForSubscription(
    subscription: StripeSubscriptionLike,
    tenantId: string | null,
  ): Promise<TenantEntity | null> {
    if (tenantId !== null) {
      return this.tenantRepository.findOneBy({ id: tenantId });
    }

    return this.tenantRepository.findOneBy({
      stripeSubscriptionId: subscription.id,
    });
  }

  private async ensureStripeCustomer(
    tenant: TenantEntity,
    auth: BillingPrincipal,
  ): Promise<string> {
    if (tenant.stripeCustomerId !== null) {
      return tenant.stripeCustomerId;
    }

    const customer = await this.getStripe().customers.create({
      email: auth.email,
      metadata: {
        ownerUserId: auth.sub,
        tenantId: tenant.id,
      },
      name: tenant.legalName,
    });

    tenant.stripeCustomerId = customer.id;
    await this.tenantRepository.save(tenant);

    return customer.id;
  }

  private getStripe(): Stripe {
    if (this.stripeClient !== null) {
      return this.stripeClient;
    }

    const secretKey = this.configService.get('STRIPE_SECRET_KEY', { infer: true });

    if (secretKey === null) {
      throw new ServiceUnavailableException('Stripe secret key is not configured.');
    }

    this.stripeClient = new StripeConstructor(secretKey);

    return this.stripeClient;
  }

  private getPriceId(plan: PaidTenantPlan): string {
    const priceId = this.configService.get(getPriceEnvironmentName(plan), {
      infer: true,
    });

    if (priceId === null) {
      throw new ServiceUnavailableException(
        `Stripe price for ${plan} is not configured.`,
      );
    }

    return priceId;
  }

  private getPlanForPriceId(priceId: string | null): PaidTenantPlan | null {
    if (priceId === null) {
      return null;
    }

    for (const plan of paidPlans) {
      if (this.configService.get(getPriceEnvironmentName(plan), { infer: true }) === priceId) {
        return plan;
      }
    }

    return null;
  }

  private async getTenantOrFail(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found.');
    }

    return tenant;
  }
}

function toBillingSubscriptionDto(tenant: TenantEntity): BillingSubscriptionDto {
  return {
    canOpenCustomerPortal: tenant.stripeCustomerId !== null,
    currentPeriodEnd: tenant.billingCurrentPeriodEnd?.toISOString() ?? null,
    plan: tenant.plan,
    status: tenant.billingStatus,
    tenantId: tenant.id,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
  };
}

function parsePaidPlan(value: unknown): PaidTenantPlan {
  if (typeof value !== 'string') {
    throw new BadRequestException('plan is required.');
  }

  if (paidPlans.some((plan) => plan === value)) {
    return value as PaidTenantPlan;
  }

  throw new BadRequestException('plan must be ESSENTIAL, PRO, or BUSINESS.');
}

function parseStripePlan(value: string | null): PaidTenantPlan | null {
  if (value === null) {
    return null;
  }

  return paidPlans.some((plan) => plan === value) ? (value as PaidTenantPlan) : null;
}

function parseUrl(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${name} is required.`);
  }

  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }

    return url.toString();
  } catch {
    throw new BadRequestException(`${name} must be a valid HTTP URL.`);
  }
}

function getPriceEnvironmentName(
  plan: PaidTenantPlan,
): 'STRIPE_PRICE_ESSENTIAL' | 'STRIPE_PRICE_PRO' | 'STRIPE_PRICE_BUSINESS' {
  switch (plan) {
    case TenantPlan.ESSENTIAL:
      return 'STRIPE_PRICE_ESSENTIAL';
    case TenantPlan.PRO:
      return 'STRIPE_PRICE_PRO';
    case TenantPlan.BUSINESS:
      return 'STRIPE_PRICE_BUSINESS';
  }
}

function getMetadataValue(
  metadata: StripeMetadata | null,
  key: string,
): string | null {
  return metadata?.[key] ?? null;
}

function getStringId(value: string | { id: string } | null): string | null {
  if (typeof value === 'string') {
    return value;
  }

  return value?.id ?? null;
}

function mapStripeSubscriptionStatus(status: string): BillingStatus {
  switch (status) {
    case 'active':
      return BillingStatus.ACTIVE;
    case 'trialing':
      return BillingStatus.TRIALING;
    case 'past_due':
      return BillingStatus.PAST_DUE;
    case 'canceled':
    case 'incomplete_expired':
      return BillingStatus.CANCELED;
    case 'incomplete':
      return BillingStatus.INCOMPLETE;
    case 'unpaid':
    case 'paused':
      return BillingStatus.UNPAID;
    default:
      return BillingStatus.INCOMPLETE;
  }
}

function getCurrentPeriodEnd(subscription: StripeSubscriptionLike): Date | null {
  const periodEnd = subscription.items.data[0]?.current_period_end;

  return toDateOrNull(periodEnd);
}

function toDateOrNull(timestamp: number | null | undefined): Date | null {
  if (timestamp === undefined || timestamp === null) {
    return null;
  }

  return new Date(timestamp * 1_000);
}
