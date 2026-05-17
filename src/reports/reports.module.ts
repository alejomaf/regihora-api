import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({})
export class ReportsModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: ReportsModule,
      };
    }

    return {
      controllers: [ReportsController],
      imports: [
        JwtModule.register({}),
        TenancyModule,
        TypeOrmModule.forFeature([
          AttendanceEventEntity,
          AuditLogEntity,
          EmployeeEntity,
          TenantEntity,
          WorkplaceEntity,
        ]),
      ],
      module: ReportsModule,
      providers: [JwtAuthGuard, ReportsService, RolesGuard],
    };
  }
}
