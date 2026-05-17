import { ReportFormat } from '../../domain/enums';

export type LegalAttendanceReportQueryDto = {
  employeeId?: unknown;
  format?: unknown;
  from?: unknown;
  includeAdjustments?: unknown;
  to?: unknown;
  workplaceId?: unknown;
};

export type LegalAttendanceReportFileDto = {
  body: Buffer;
  contentType: string;
  filename: string;
  format: ReportFormat;
};
