import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { EmployeeInvitationEntity } from '../database/entities/employee-invitation.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { UserEntity } from '../database/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PasswordHasher } from './password/password-hasher.service';

@Module({})
export class AuthModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: AuthModule,
      };
    }

    return {
      controllers: [AuthController],
      exports: [AuthService, JwtAuthGuard, RolesGuard, PasswordHasher],
      imports: [
        JwtModule.register({}),
        TypeOrmModule.forFeature([
          UserEntity,
          SessionEntity,
          TenantEntity,
          EmployeeEntity,
          EmployeeInvitationEntity,
        ]),
      ],
      module: AuthModule,
      providers: [AuthService, JwtAuthGuard, RolesGuard, PasswordHasher],
    };
  }
}
