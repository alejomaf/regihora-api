import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { DeviceEntity } from '../database/entities/device.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { TurnstileAttendanceController } from './turnstile-attendance.controller';

@Module({})
export class AttendanceModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: AttendanceModule,
      };
    }

    return {
      controllers: [AttendanceController, TurnstileAttendanceController],
      imports: [
        JwtModule.register({}),
        TenancyModule,
        TypeOrmModule.forFeature([
          AttendanceEventEntity,
          AttendancePolicyEntity,
          DeviceEntity,
          EmployeeEntity,
          SessionEntity,
          TenantEntity,
          WorkplaceEntity,
        ]),
      ],
      module: AttendanceModule,
      providers: [AttendanceService, JwtAuthGuard],
    };
  }
}
