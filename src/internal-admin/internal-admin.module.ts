import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AuditLogEntity,
  EmployeeEntity,
  SupportTicketEntity,
  SupportTicketMessageEntity,
  TenantEntity,
  UserEntity,
} from '../database/entities';
import { InternalAdminController } from './internal-admin.controller';
import { InternalAdminGuard } from './internal-admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      EmployeeEntity,
      SupportTicketEntity,
      SupportTicketMessageEntity,
      TenantEntity,
      UserEntity,
    ]),
  ],
  controllers: [InternalAdminController],
  providers: [InternalAdminGuard],
})
export class InternalAdminModule {}
