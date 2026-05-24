import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthenticatedPrincipal } from '../auth/types/authenticated-principal';
import { UserRole } from '../domain/enums';
import { CurrentTenant } from '../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import { BillingService } from './billing.service';
import {
  BillingCheckoutSessionCreateRequestDto,
  BillingCheckoutSessionDto,
  BillingCustomerPortalSessionCreateRequestDto,
  BillingCustomerPortalSessionDto,
  BillingSubscriptionDto,
} from './dto/billing.dto';

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@Controller('v1/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('subscription')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.HR_ADMIN)
  getSubscription(
    @CurrentTenant() tenant: CurrentTenantContext,
  ): Promise<BillingSubscriptionDto> {
    return this.billingService.getSubscription(tenant.tenantId);
  }

  @Post('checkout-sessions')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  createCheckoutSession(
    @CurrentTenant() tenant: CurrentTenantContext,
    @CurrentAuth() auth: AuthenticatedPrincipal,
    @Body() request: BillingCheckoutSessionCreateRequestDto,
  ): Promise<BillingCheckoutSessionDto> {
    return this.billingService.createCheckoutSession(
      tenant.tenantId,
      auth,
      request,
    );
  }

  @Post('customer-portal-sessions')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  createCustomerPortalSession(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Body() request: BillingCustomerPortalSessionCreateRequestDto,
  ): Promise<BillingCustomerPortalSessionDto> {
    return this.billingService.createCustomerPortalSession(
      tenant.tenantId,
      request,
    );
  }

  @Post('stripe/webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  handleStripeWebhook(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() request: RawBodyRequest,
  ): Promise<void> {
    return this.billingService.handleStripeWebhook(
      signature,
      getRawBodyBuffer(request),
    );
  }
}

function getRawBodyBuffer(request: RawBodyRequest): Buffer {
  if (request.rawBody !== undefined) {
    return request.rawBody;
  }

  if (Buffer.isBuffer(request.body)) {
    return request.body;
  }

  if (typeof request.body === 'string') {
    return Buffer.from(request.body);
  }

  return Buffer.from(JSON.stringify(request.body ?? {}));
}
