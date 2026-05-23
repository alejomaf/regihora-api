import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('App health endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.LOG_LEVEL = 'error';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            environment: 'test',
            service: 'regihora-api',
            status: 'ok',
          }),
        );
      });
  });
});
