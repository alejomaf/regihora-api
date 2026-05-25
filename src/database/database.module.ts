import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config as loadDotEnv } from 'dotenv';

import { getEnvironmentFilePaths } from '../config/environment-file-paths';
import {
  EnvironmentVariables,
  validateEnvironment,
} from '../config/environment.validation';
import { createTypeOrmOptions } from './typeorm-options';

@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    for (const path of getEnvironmentFilePaths()) {
      loadDotEnv({ path, override: false, quiet: true });
    }

    const environment = validateEnvironment(process.env);

    if (!environment.DATABASE_ENABLED) {
      return {
        module: DatabaseModule,
      };
    }

    return {
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (
            configService: ConfigService<EnvironmentVariables, true>,
          ) => createTypeOrmOptions(getEnvironmentFromConfig(configService)),
        }),
      ],
      module: DatabaseModule,
    };
  }
}

function getEnvironmentFromConfig(
  configService: ConfigService<EnvironmentVariables, true>,
): EnvironmentVariables {
  return {
    CORS_ALLOWED_ORIGINS: configService.get('CORS_ALLOWED_ORIGINS', { infer: true }),
    DATABASE_ENABLED: configService.get('DATABASE_ENABLED', { infer: true }),
    DATABASE_HOST: configService.get('DATABASE_HOST', { infer: true }),
    DATABASE_LOGGING: configService.get('DATABASE_LOGGING', { infer: true }),
    DATABASE_NAME: configService.get('DATABASE_NAME', { infer: true }),
    DATABASE_PASSWORD: configService.get('DATABASE_PASSWORD', { infer: true }),
    DATABASE_PORT: configService.get('DATABASE_PORT', { infer: true }),
    DATABASE_SSL: configService.get('DATABASE_SSL', { infer: true }),
    DATABASE_USER: configService.get('DATABASE_USER', { infer: true }),
    JWT_ACCESS_TOKEN_SECRET: configService.get('JWT_ACCESS_TOKEN_SECRET', {
      infer: true,
    }),
    JWT_ACCESS_TOKEN_TTL_SECONDS: configService.get(
      'JWT_ACCESS_TOKEN_TTL_SECONDS',
      { infer: true },
    ),
    JWT_AUDIENCE: configService.get('JWT_AUDIENCE', { infer: true }),
    JWT_ISSUER: configService.get('JWT_ISSUER', { infer: true }),
    JWT_REFRESH_TOKEN_TTL_SECONDS: configService.get(
      'JWT_REFRESH_TOKEN_TTL_SECONDS',
      { infer: true },
    ),
    GOOGLE_OAUTH_CLIENT_ID: configService.get('GOOGLE_OAUTH_CLIENT_ID', {
      infer: true,
    }),
    WEBAPP_BASE_URL: configService.get('WEBAPP_BASE_URL', { infer: true }),
    EMPLOYEE_INVITATION_TTL_HOURS: configService.get(
      'EMPLOYEE_INVITATION_TTL_HOURS',
      { infer: true },
    ),
    EMAIL_DELIVERY_MODE: configService.get('EMAIL_DELIVERY_MODE', { infer: true }),
    EMAIL_FROM: configService.get('EMAIL_FROM', { infer: true }),
    SMTP_HOST: configService.get('SMTP_HOST', { infer: true }),
    SMTP_PORT: configService.get('SMTP_PORT', { infer: true }),
    SMTP_SECURE: configService.get('SMTP_SECURE', { infer: true }),
    SMTP_USER: configService.get('SMTP_USER', { infer: true }),
    SMTP_PASSWORD: configService.get('SMTP_PASSWORD', { infer: true }),
    LOG_LEVEL: configService.get('LOG_LEVEL', { infer: true }),
    NODE_ENV: configService.get('NODE_ENV', { infer: true }),
    PORT: configService.get('PORT', { infer: true }),
    SERVICE_NAME: configService.get('SERVICE_NAME', { infer: true }),
    STRIPE_PRICE_BUSINESS: configService.get('STRIPE_PRICE_BUSINESS', {
      infer: true,
    }),
    STRIPE_PRICE_ESSENTIAL: configService.get('STRIPE_PRICE_ESSENTIAL', {
      infer: true,
    }),
    STRIPE_PRICE_PRO: configService.get('STRIPE_PRICE_PRO', { infer: true }),
    STRIPE_SECRET_KEY: configService.get('STRIPE_SECRET_KEY', { infer: true }),
    STRIPE_WEBHOOK_SECRET: configService.get('STRIPE_WEBHOOK_SECRET', {
      infer: true,
    }),
  };
}
