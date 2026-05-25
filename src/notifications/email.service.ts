import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

import { EnvironmentVariables } from '../config/environment.validation';

export type EmailDeliveryStatus = 'DISABLED' | 'FAILED' | 'LOGGED' | 'SENT';

export type EmailDeliveryResult = {
  status: EmailDeliveryStatus;
};

export type EmailMessage = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    const mode = this.configService.get('EMAIL_DELIVERY_MODE', { infer: true });

    if (mode === 'disabled') {
      return { status: 'DISABLED' };
    }

    if (mode === 'log') {
      this.logger.log(
        `Email delivery logged for ${message.to}: ${message.subject}`,
      );

      return { status: 'LOGGED' };
    }

    try {
      await this.getTransporter().sendMail({
        from: this.configService.get('EMAIL_FROM', { infer: true }) ?? undefined,
        html: message.html,
        subject: message.subject,
        text: message.text,
        to: message.to,
      });

      return { status: 'SENT' };
    } catch (error) {
      this.logger.error(
        'SMTP email delivery failed.',
        error instanceof Error ? error.stack : undefined,
      );

      return { status: 'FAILED' };
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter !== null) {
      return this.transporter;
    }

    const user = this.configService.get('SMTP_USER', { infer: true });
    const pass = this.configService.get('SMTP_PASSWORD', { infer: true });

    this.transporter = nodemailer.createTransport({
      auth:
        user === null || pass === null
          ? undefined
          : {
              pass,
              user,
            },
      host: this.configService.get('SMTP_HOST', { infer: true }) ?? undefined,
      port: this.configService.get('SMTP_PORT', { infer: true }),
      secure: this.configService.get('SMTP_SECURE', { infer: true }),
    });

    return this.transporter;
  }
}
