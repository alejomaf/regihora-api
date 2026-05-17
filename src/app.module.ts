import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AdjustmentsModule } from './adjustments/adjustments.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AttendancePoliciesModule } from './attendance-policies/attendance-policies.module';
import { getEnvironmentFilePaths } from './config/environment-file-paths';
import { validateEnvironment } from './config/environment.validation';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { RequestLoggerMiddleware } from './logging/request-logger.middleware';
import { OrganizationModule } from './organization/organization.module';
import { QrDevicesModule } from './qr-devices/qr-devices.module';
import { ReportsModule } from './reports/reports.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: getEnvironmentFilePaths(),
      isGlobal: true,
      validate: validateEnvironment,
    }),
    DatabaseModule.forRoot(),
    AuthModule.forRoot(),
    TenancyModule,
    AttendancePoliciesModule.forRoot(),
    AttendanceModule.forRoot(),
    AdjustmentsModule.forRoot(),
    QrDevicesModule.forRoot(),
    ReportsModule.forRoot(),
    OrganizationModule.forRoot(),
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
