import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLoggerMiddleware.name);

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      const durationMilliseconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const message = `${request.method} ${request.originalUrl} ${String(response.statusCode)} ${durationMilliseconds.toFixed(1)}ms`;

      if (response.statusCode >= 500) {
        this.logger.error(message);
        return;
      }

      if (response.statusCode >= 400) {
        this.logger.warn(message);
        return;
      }

      this.logger.log(message);
    });

    next();
  }
}
