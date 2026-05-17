import { Logger } from '@nestjs/common';
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
  });
  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const logLevel = configService.get('LOG_LEVEL', { infer: true });
  const port = configService.get('PORT', { infer: true });
  const serviceName = configService.get('SERVICE_NAME', { infer: true });

  app.useLogger(getEnabledLogLevels(logLevel));
  app.use(text({ limit: '1mb', type: ['text/csv', 'text/plain'] }));
  app.enableShutdownHooks();

  await app.listen(port);

  Logger.log(`${serviceName} listening on port ${String(port)}`, 'Bootstrap');
}

void bootstrap();
