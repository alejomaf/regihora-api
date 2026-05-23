import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { validateEnvironment } from '../config/environment.validation';
import { HealthService } from './health.service';

describe(HealthService.name, () => {
  let service: HealthService;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';
    process.env.SERVICE_NAME = 'regihora-api-test';
    process.env.LOG_LEVEL = 'error';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          validate: validateEnvironment,
        }),
      ],
      providers: [HealthService],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it('returns service health metadata', () => {
    const health = service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('regihora-api-test');
    expect(health.environment).toBe('test');
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(new Date(health.timestamp).toString()).not.toBe('Invalid Date');
  });
});
