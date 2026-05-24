import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import { validateEnvironment } from '../config/environment.validation';
import { DeviceEntity } from '../database/entities/device.entity';
import { SessionEntity } from '../database/entities/session.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import { TenancyModule } from '../tenancy/tenancy.module';
import { QrDevicesController } from './qr-devices.controller';
import { QrDevicesService } from './qr-devices.service';

@Module({})
export class QrDevicesModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: QrDevicesModule,
      };
    }

    return {
      controllers: [QrDevicesController],
      imports: [
        JwtModule.register({}),
        TenancyModule,
        TypeOrmModule.forFeature([DeviceEntity, SessionEntity, WorkplaceEntity]),
      ],
      module: QrDevicesModule,
      providers: [QrDevicesService, JwtAuthGuard, RolesGuard],
    };
  }
}
