import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AttendancePoliciesController } from './attendance-policies.controller';
import { AttendancePoliciesService } from './attendance-policies.service';

@Module({})
export class AttendancePoliciesModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: AttendancePoliciesModule,
      };
    }

    return {
      controllers: [AttendancePoliciesController],
      imports: [
        JwtModule.register({}),
        TenancyModule,
        TypeOrmModule.forFeature([AttendancePolicyEntity, WorkplaceEntity]),
      ],
      module: AttendancePoliciesModule,
      providers: [AttendancePoliciesService, JwtAuthGuard, RolesGuard],
    };
  }
}
