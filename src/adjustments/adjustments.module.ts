import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { AttendanceAdjustmentEntity } from '../database/entities/attendance-adjustment.entity';
import { AttendanceDailySummaryEntity } from '../database/entities/attendance-daily-summary.entity';
import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';
import { AttendanceDailySummaryService } from './attendance-daily-summary.service';

@Module({})
export class AdjustmentsModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: AdjustmentsModule,
      };
    }

    return {
      controllers: [AdjustmentsController],
      imports: [
        JwtModule.register({}),
        TenancyModule,
        TypeOrmModule.forFeature([
          AttendanceAdjustmentEntity,
          AttendanceDailySummaryEntity,
          AttendanceEventEntity,
          AuditLogEntity,
          EmployeeEntity,
          SessionEntity,
          TenantEntity,
          WorkplaceEntity,
        ]),
      ],
      module: AdjustmentsModule,
      providers: [
        AdjustmentsService,
        AttendanceDailySummaryService,
        JwtAuthGuard,
        RolesGuard,
      ],
    };
  }
}
