import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../domain/enums';
import { CurrentTenant } from '../tenancy/decorators/current-tenant.decorator';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import type { LegalAttendanceReportQueryDto } from './dto/legal-attendance-report.dto';
import { ReportsService } from './reports.service';

@Controller('v1/reports/attendance')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('legal')
  @Roles(
    UserRole.EMPLOYEE,
    UserRole.MANAGER,
    UserRole.HR_ADMIN,
    UserRole.OWNER,
    UserRole.AUDITOR,
  )
  async exportLegalAttendanceReport(
    @CurrentTenant() tenant: CurrentTenantContext,
    @Query() query: LegalAttendanceReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.reportsService.exportLegalAttendanceReport(
      tenant,
      query,
    );

    response.setHeader('Content-Type', file.contentType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.setHeader('Content-Length', file.body.byteLength);

    return new StreamableFile(file.body);
  }
}
