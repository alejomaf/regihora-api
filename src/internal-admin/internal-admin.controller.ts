import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import {
  AuditLogEntity,
  EmployeeEntity,
  SupportTicketEntity,
  SupportTicketMessageEntity,
  TenantEntity,
  UserEntity,
} from '../database/entities';
import {
  BillingStatus,
  EmployeeStatus,
  SupportTicketPriority,
  SupportTicketStatus,
  TenantPlan,
  UserRole,
} from '../domain/enums';
import { InternalAdminGuard } from './internal-admin.guard';

type MutationBody = {
  reason?: string;
  [key: string]: unknown;
};

@Controller('internal/admin')
@UseGuards(InternalAdminGuard)
export class InternalAdminController {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditRepository: Repository<AuditLogEntity>,
    @InjectRepository(SupportTicketEntity)
    private readonly ticketRepository: Repository<SupportTicketEntity>,
    @InjectRepository(SupportTicketMessageEntity)
    private readonly ticketMessageRepository: Repository<SupportTicketMessageEntity>,
  ) {}

  @Get('health')
  health() {
    return {
      project: 'regihora',
      status: 'healthy',
      checkedAt: new Date().toISOString(),
    };
  }

  @Get('capabilities')
  capabilities() {
    return {
      metrics: true,
      users: {
        list: true,
        detail: true,
        invite: true,
        update: false,
        grantEntitlement: true,
      },
      issues: {
        list: true,
        updateStatus: true,
        reply: true,
      },
      payments: {
        list: false,
        refund: false,
      },
      communications: {
        send: false,
        channels: [],
        locales: ['es-ES', 'en'],
      },
      audit: true,
    };
  }

  @Get('metrics')
  async metrics() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalUsers, recentUsers, activeUsers, premiumTenants, openIssues] = await Promise.all([
      this.employeeRepository.count(),
      this.employeeRepository
        .createQueryBuilder('employee')
        .where('employee.createdAt >= :since', { since })
        .getCount(),
      this.employeeRepository.count({ where: { status: EmployeeStatus.ACTIVE } }),
      this.tenantRepository
        .createQueryBuilder('tenant')
        .where('tenant.plan != :freePlan', { freePlan: TenantPlan.FREE })
        .andWhere('tenant.billingStatus IN (:...statuses)', {
          statuses: [BillingStatus.ACTIVE, BillingStatus.TRIALING],
        })
        .getCount(),
      this.ticketRepository
        .createQueryBuilder('ticket')
        .where('ticket.status IN (:...statuses)', {
          statuses: [SupportTicketStatus.OPEN, SupportTicketStatus.IN_PROGRESS],
        })
        .getCount(),
    ]);

    return {
      project: 'regihora',
      totalUsers,
      recentUsers,
      activeUsers,
      premiumUsers: premiumTenants,
      openIssues,
      totalRevenueCents: 0,
      refundedRevenueCents: 0,
      currency: 'EUR',
    };
  }

  @Get('users')
  async users(@Query('q') q?: string, @Query('limit') rawLimit?: string) {
    const limit = clampLimit(rawLimit);
    const where = buildEmployeeWhere(q);
    const [items, total] = await this.employeeRepository.findAndCount({
      where,
      relations: { tenant: true, user: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return {
      data: items.map(toAdminUser),
      total,
      page: 1,
      limit,
    };
  }

  @Get('users/:id')
  async user(@Param('id') id: string) {
    const employee = await this.employeeRepository.findOne({
      where: { id },
      relations: { tenant: true, user: true },
    });

    if (employee === null) {
      throw new NotFoundException('Employee not found.');
    }

    return toAdminUser(employee);
  }

  @Post('users/invite')
  async inviteUser(
    @Body() body: MutationBody,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-admin-hub-request-id') requestId?: string,
  ) {
    requireMutation(body, idempotencyKey);
    const tenantId = requireString(body.tenantId, 'tenantId');
    const email = requireString(body.email, 'email').trim().toLowerCase();
    const displayName = requireString(body.displayName, 'displayName').trim();
    const tenant = await this.tenantRepository.findOneBy({ id: tenantId });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found.');
    }

    const existingEmployee = await this.employeeRepository.findOneBy({ tenantId, email });
    if (existingEmployee !== null) {
      throw new BadRequestException('Employee already exists for this tenant.');
    }

    let user = await this.userRepository.findOneBy({ email });
    if (user === null) {
      user = await this.userRepository.save(
        this.userRepository.create({
          email,
          displayName,
          passwordHash: null,
          isActive: true,
        }),
      );
    }

    const employee = await this.employeeRepository.save(
      this.employeeRepository.create({
        tenantId,
        userId: user.id,
        email,
        displayName,
        roles: [parseUserRole(body.role)],
        status: EmployeeStatus.INVITED,
      }),
    );
    employee.tenant = tenant;
    employee.user = user;

    const audit = await this.recordAudit({
      tenantId,
      actorUserId: null,
      action: 'admin_hub.employee.invited',
      entityType: 'employee',
      entityId: employee.id,
      requestId,
      reason: body.reason,
      idempotencyKey,
      metadata: { email },
    });

    return {
      data: toAdminUser(employee),
      remoteAuditId: audit.id,
    };
  }

  @Post('users/:id/grant-entitlement')
  async grantEntitlement(
    @Param('id') id: string,
    @Body() body: MutationBody,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-admin-hub-request-id') requestId?: string,
  ) {
    requireMutation(body, idempotencyKey);
    const plan = parseTenantPlan(body.plan);
    const employee = await this.employeeRepository.findOne({
      where: { id },
      relations: { tenant: true, user: true },
    });
    const tenant =
      employee?.tenant ?? (await this.tenantRepository.findOneBy({ id }));

    if (tenant === null) {
      throw new NotFoundException('Tenant or employee not found.');
    }

    tenant.plan = plan;
    tenant.billingStatus = plan === TenantPlan.FREE ? BillingStatus.FREE : BillingStatus.ACTIVE;
    tenant.billingCurrentPeriodEnd = parsePeriodEnd(body.durationDays);
    await this.tenantRepository.save(tenant);

    const audit = await this.recordAudit({
      tenantId: tenant.id,
      actorUserId: null,
      action: 'admin_hub.tenant.plan_granted',
      entityType: 'tenant',
      entityId: tenant.id,
      requestId,
      reason: body.reason,
      idempotencyKey,
      metadata: { plan },
    });

    return {
      data: {
        id: tenant.id,
        plan: tenant.plan,
        status: tenant.billingStatus,
        provider: tenant.stripeSubscriptionId ? 'stripe' : 'manual',
        currentPeriodEnd: tenant.billingCurrentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: false,
      },
      remoteAuditId: audit.id,
    };
  }

  @Get('issues')
  async issues(
    @Query('status') rawStatus?: string,
    @Query('limit') rawLimit?: string,
  ) {
    const limit = clampLimit(rawLimit);
    const status = parseOptionalTicketStatus(rawStatus);
    const query = this.ticketRepository
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.user', 'user')
      .leftJoinAndSelect('ticket.tenant', 'tenant')
      .orderBy('ticket.createdAt', 'DESC')
      .take(limit);

    if (status) {
      query.where('ticket.status = :status', { status });
    }

    const [items, total] = await query.getManyAndCount();

    return {
      data: items.map(toAdminIssue),
      total,
      page: 1,
      limit,
    };
  }

  @Patch('issues/:id')
  async updateIssue(
    @Param('id') id: string,
    @Body() body: MutationBody,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-admin-hub-request-id') requestId?: string,
  ) {
    requireMutation(body, idempotencyKey);
    const status = parseTicketStatus(body.status);
    const adminNotes = typeof body.adminNotes === 'string' ? body.adminNotes.trim() : '';
    const ticket = await this.ticketRepository.findOne({
      where: { id },
      relations: { tenant: true, user: true },
    });

    if (ticket === null) {
      throw new NotFoundException('Support ticket not found.');
    }

    ticket.status = status;
    ticket.resolvedAt = isResolvedStatus(status) ? new Date() : null;
    await this.ticketRepository.save(ticket);

    if (adminNotes.length > 0) {
      await this.ticketMessageRepository.save(
        this.ticketMessageRepository.create({
          ticketId: ticket.id,
          isAdmin: true,
          authorLabel: 'admin_hub',
          body: adminNotes,
        }),
      );
    }

    const audit = await this.recordAudit({
      tenantId: ticket.tenantId,
      actorUserId: null,
      action: 'admin_hub.issue.updated',
      entityType: 'support_ticket',
      entityId: ticket.id,
      requestId,
      reason: body.reason,
      idempotencyKey,
      metadata: { status, adminNotes: adminNotes.length > 0 },
    });

    return {
      data: toAdminIssue(ticket),
      remoteAuditId: audit.id,
    };
  }

  @Post('issues/:id/reply')
  async replyIssue(
    @Param('id') id: string,
    @Body() body: MutationBody,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-admin-hub-request-id') requestId?: string,
  ) {
    requireMutation(body, idempotencyKey);
    const response = requireString(body.response, 'response').trim();
    const requestedStatus = parseOptionalTicketStatus(
      typeof body.status === 'string' ? body.status : undefined,
    );
    const ticket = await this.ticketRepository.findOne({
      where: { id },
      relations: { tenant: true, user: true },
    });

    if (ticket === null) {
      throw new NotFoundException('Support ticket not found.');
    }

    const status = requestedStatus ?? SupportTicketStatus.IN_PROGRESS;
    await this.ticketMessageRepository.save(
      this.ticketMessageRepository.create({
        ticketId: ticket.id,
        isAdmin: true,
        authorLabel: 'admin_hub',
        body: response,
      }),
    );

    ticket.status = status;
    ticket.resolvedAt = isResolvedStatus(status) ? new Date() : null;
    await this.ticketRepository.save(ticket);

    const audit = await this.recordAudit({
      tenantId: ticket.tenantId,
      actorUserId: null,
      action: 'admin_hub.issue.replied',
      entityType: 'support_ticket',
      entityId: ticket.id,
      requestId,
      reason: body.reason,
      idempotencyKey,
      metadata: { status },
    });

    return {
      data: toAdminIssue(ticket),
      remoteAuditId: audit.id,
    };
  }

  @Get('payments')
  payments() {
    return { data: [], total: 0, page: 1, limit: 20 };
  }

  @Post('payments/:id/refund')
  refundPayment() {
    throw new NotImplementedException('RegiHora does not store provider charge ids for refunds.');
  }

  @Post('communications/send')
  sendCommunication() {
    throw new NotImplementedException('RegiHora does not have an admin communication sender yet.');
  }

  private async recordAudit(input: {
    tenantId: string | null;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    requestId?: string | undefined;
    reason?: unknown;
    idempotencyKey?: string | undefined;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLogEntity> {
    return this.auditRepository.save(
      this.auditRepository.create({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        metadata: {
          reason: String(input.reason ?? ''),
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          ...(input.metadata ?? {}),
        },
      }),
    );
  }
}

function buildEmployeeWhere(q?: string) {
  const query = q?.trim();

  if (!query) {
    return {};
  }

  return [
    { id: query },
    { email: ILike(`%${query}%`) },
    { displayName: ILike(`%${query}%`) },
    { tenant: { legalName: ILike(`%${query}%`) } },
  ];
}

function toAdminUser(employee: EmployeeEntity) {
  return {
    id: employee.id,
    project: 'regihora',
    email: employee.email,
    displayName: employee.displayName,
    role: employee.roles.join(','),
    locale: employee.tenant?.locale ?? null,
    status: employee.status,
    createdAt: employee.createdAt.toISOString(),
    tenantId: employee.tenantId,
    activeSubscription: employee.tenant
      ? {
          id: employee.tenant.id,
          plan: employee.tenant.plan,
          status: employee.tenant.billingStatus,
          provider: employee.tenant.stripeSubscriptionId ? 'stripe' : 'manual',
          currentPeriodEnd: employee.tenant.billingCurrentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: false,
        }
      : null,
    raw: {
      tenantName: employee.tenant?.legalName,
      userId: employee.userId,
    },
  };
}

function toAdminIssue(ticket: SupportTicketEntity) {
  return {
    id: ticket.id,
    project: 'regihora',
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status.toLowerCase(),
    priority: ticket.priority.toLowerCase(),
    type: ticket.category,
    userId: ticket.userId,
    userEmail: ticket.user?.email ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    raw: {
      tenantId: ticket.tenantId,
      tenantName: ticket.tenant?.legalName,
    },
  };
}

function requireMutation(body: MutationBody, idempotencyKey?: string): void {
  if (!idempotencyKey?.trim()) {
    throw new BadRequestException('Idempotency-Key is required.');
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length < 3) {
    throw new BadRequestException('reason is required.');
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required.`);
  }

  return value;
}

function parseUserRole(value: unknown): UserRole {
  if (typeof value === 'string' && Object.values(UserRole).includes(value as UserRole)) {
    return value as UserRole;
  }

  return UserRole.EMPLOYEE;
}

function parseTenantPlan(value: unknown): TenantPlan {
  if (typeof value === 'string' && Object.values(TenantPlan).includes(value as TenantPlan)) {
    return value as TenantPlan;
  }

  throw new BadRequestException('plan must be a valid RegiHora tenant plan.');
}

function parsePeriodEnd(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3660) {
    throw new BadRequestException('durationDays must be between 1 and 3660.');
  }

  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function parseOptionalTicketStatus(value: string | undefined): SupportTicketStatus | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return parseTicketStatus(value);
}

function parseTicketStatus(value: unknown): SupportTicketStatus {
  if (typeof value !== 'string') {
    throw new BadRequestException('status is required.');
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'OPEN') return SupportTicketStatus.OPEN;
  if (normalized === 'IN_PROGRESS' || normalized === 'IN PROGRESS') {
    return SupportTicketStatus.IN_PROGRESS;
  }
  if (normalized === 'RESOLVED') return SupportTicketStatus.RESOLVED;
  if (normalized === 'CLOSED') return SupportTicketStatus.CLOSED;

  throw new BadRequestException('status must be open, in_progress, resolved, or closed.');
}

function isResolvedStatus(status: SupportTicketStatus): boolean {
  return status === SupportTicketStatus.RESOLVED || status === SupportTicketStatus.CLOSED;
}

function clampLimit(rawLimit?: string): number {
  const parsed = Number(rawLimit ?? 20);
  if (!Number.isInteger(parsed)) {
    return 20;
  }

  return Math.min(Math.max(parsed, 1), 100);
}
