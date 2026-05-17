import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EnvironmentVariables,
  NodeEnvironment,
} from '../config/environment.validation';

export type HealthResponse = {
  status: 'ok';
  service: string;
  environment: NodeEnvironment;
  uptimeSeconds: number;
  timestamp: string;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  getHealth(): HealthResponse {
    return {
      environment: this.configService.get('NODE_ENV', { infer: true }),
      service: this.configService.get('SERVICE_NAME', { infer: true }),
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}

