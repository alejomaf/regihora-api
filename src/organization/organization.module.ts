import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { AttendancePolicyEntity } from '../database/entities/attendance-policy.entity';
import { DepartmentEntity } from '../database/entities/department.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DepartmentsController } from './departments/departments.controller';
import { DepartmentsService } from './departments/departments.service';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { WorkplacesController } from './workplaces/workplaces.controller';
import { WorkplacesService } from './workplaces/workplaces.service';

@Module({})
export class OrganizationModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: OrganizationModule,
      };
    }

    return {
      controllers: [
        DepartmentsController,
        EmployeesController,
        WorkplacesController,
      ],
      imports: [
        JwtModule.register({}),
        TenancyModule,
        TypeOrmModule.forFeature([
          AttendancePolicyEntity,
          DepartmentEntity,
          EmployeeEntity,
          SessionEntity,
          WorkplaceEntity,
        ]),
      ],
      module: OrganizationModule,
      providers: [
        DepartmentsService,
        EmployeesService,
        JwtAuthGuard,
        RolesGuard,
        WorkplacesService,
      ],
    };
  }
}
