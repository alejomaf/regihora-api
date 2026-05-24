import { Logger } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { text } from 'express';
import 'reflect-metadata';

import { AppModule } from './app.module';
import { EnvironmentVariables } from './config/environment.validation';
import { getEnabledLogLevels } from './logging/logger-levels';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const logLevel = configService.get('LOG_LEVEL', { infer: true });
  const port = configService.get('PORT', { infer: true });
  const serviceName = configService.get('SERVICE_NAME', { infer: true });
  const allowedCorsOrigins = configService.get('CORS_ALLOWED_ORIGINS', {
    infer: true,
  });

  app.useLogger(getEnabledLogLevels(logLevel));
  app.enableCors(createCorsOptions(allowedCorsOrigins));
  app.use(text({ limit: '1mb', type: ['text/csv', 'text/plain'] }));
  app.enableShutdownHooks();

  await app.listen(port);

  Logger.log(`${serviceName} listening on port ${String(port)}`, 'Bootstrap');
}

void bootstrap();

function createCorsOptions(allowedOrigins: string[]): CorsOptions {
  return {
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Regihora-Device-Token',
      'X-Regihora-Tenant-Id',
    ],
    credentials: false,
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    optionsSuccessStatus: 204,
    origin: (origin, callback) => {
      if (origin === undefined || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS.'), false);
    },
  };
}
