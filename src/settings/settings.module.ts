import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { SessionEntity } from '../database/entities/session.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({})
export class SettingsModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: SettingsModule,
      };
    }

    return {
      controllers: [SettingsController],
      imports: [
        JwtModule.register({}),
        TenancyModule,
        TypeOrmModule.forFeature([SessionEntity, TenantEntity]),
      ],
      module: SettingsModule,
      providers: [JwtAuthGuard, RolesGuard, SettingsService],
    };
  }
}
