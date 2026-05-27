import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { Between, FindOptionsWhere, In, Repository } from 'typeorm';

import { AttendanceEventEntity } from '../database/entities/attendance-event.entity';
import { AuditLogEntity } from '../database/entities/audit-log.entity';
import { EmployeeEntity } from '../database/entities/employee.entity';
import { TenantEntity } from '../database/entities/tenant.entity';
import { WorkplaceEntity } from '../database/entities/workplace.entity';
import {
  AttendanceEventType,
  EmployeeStatus,
  PunchAction,
  ReportFormat,
  UserRole,
} from '../domain/enums';
import type { CurrentTenantContext } from '../tenancy/types/current-tenant';
import type {
  LegalAttendanceReportFileDto,
  LegalAttendanceReportQueryDto,
} from './dto/legal-attendance-report.dto';

type ParsedLegalAttendanceReportQuery = {
  employeeId: string | null;
  format: ReportFormat;
  from: string;
  includeAdjustments: boolean;
  to: string;
  workplaceId: string | null;
};

type LegalAttendanceReport = {
  generatedAt: Date;
  includeAdjustments: boolean;
  periodFrom: string;
  periodTo: string;
  rows: LegalAttendanceReportRow[];
  tenant: TenantEntity;
};

type LegalAttendanceReportRow = {
  adjustmentEventCount: number;
  breakMinutes: number;
  employeeEmail: string;
  employeeId: string;
  employeeName: string;
  eventCount: number;
  events: string;
  firstClockIn: string;
  incidents: string;
  lastClockOut: string;
  localDate: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  tenantLegalName: string;
  tenantTaxId: string;
  timezone: string;
  workedHours: number;
  workedMinutes: number;
  workplaceId: string;
  workplaceName: string;
};

type LegalAttendanceReportColumn = {
  header: string;
  key: keyof LegalAttendanceReportRow;
  width: number;
};

type DailyCalculation = {
  adjustmentEventCount: number;
  breakMinutes: number;
  eventCount: number;
  eventTimeline: string;
  firstClockInAt: Date | null;
  incidents: string[];
  lastClockOutAt: Date | null;
  openBreak: boolean;
  openSession: boolean;
  workedMinutes: number;
};

const legalReportColumns: LegalAttendanceReportColumn[] = [
  { header: 'Empresa', key: 'tenantLegalName', width: 28 },
  { header: 'CIF/NIF', key: 'tenantTaxId', width: 14 },
  { header: 'Desde', key: 'periodFrom', width: 12 },
  { header: 'Hasta', key: 'periodTo', width: 12 },
  { header: 'Empleado', key: 'employeeName', width: 28 },
  { header: 'Email empleado', key: 'employeeEmail', width: 32 },
  { header: 'Empleado ID', key: 'employeeId', width: 38 },
  { header: 'Centro', key: 'workplaceName', width: 24 },
  { header: 'Centro ID', key: 'workplaceId', width: 38 },
  { header: 'Fecha', key: 'localDate', width: 12 },
  { header: 'Zona horaria', key: 'timezone', width: 20 },
  { header: 'Entrada', key: 'firstClockIn', width: 12 },
  { header: 'Salida', key: 'lastClockOut', width: 12 },
  { header: 'Minutos trabajados', key: 'workedMinutes', width: 18 },
  { header: 'Horas trabajadas', key: 'workedHours', width: 16 },
  { header: 'Minutos pausa', key: 'breakMinutes', width: 15 },
  { header: 'Eventos', key: 'eventCount', width: 10 },
  { header: 'Ajustes', key: 'adjustmentEventCount', width: 10 },
  { header: 'Estado', key: 'status', width: 18 },
  { header: 'Incidencias', key: 'incidents', width: 28 },
  { header: 'Secuencia de eventos', key: 'events', width: 72 },
];

const privilegedReportRoles = new Set<UserRole>([
  UserRole.AUDITOR,
  UserRole.HR_ADMIN,
  UserRole.MANAGER,
  UserRole.OWNER,
]);

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(AttendanceEventEntity)
    private readonly eventRepository: Repository<AttendanceEventEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    @InjectRepository(EmployeeEntity)
    private readonly employeeRepository: Repository<EmployeeEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(WorkplaceEntity)
    private readonly workplaceRepository: Repository<WorkplaceEntity>,
  ) {}

  async exportLegalAttendanceReport(
    currentTenant: CurrentTenantContext,
    query: LegalAttendanceReportQueryDto,
  ): Promise<LegalAttendanceReportFileDto> {
    const parsedQuery = parseLegalAttendanceReportQuery(query);
    const report = await this.buildLegalAttendanceReport(currentTenant, parsedQuery);
    const file = await this.renderLegalAttendanceReport(report, parsedQuery.format);

    await this.auditLogRepository.save(
      this.auditLogRepository.create({
        action: 'attendance_report.exported',
        actorEmployeeId: currentTenant.employeeId,
        actorUserId: currentTenant.userId,
        entityId: null,
        entityType: 'attendance_report',
        metadata: {
          employeeId: parsedQuery.employeeId,
          format: parsedQuery.format,
          from: parsedQuery.from,
          includeAdjustments: parsedQuery.includeAdjustments,
          rowCount: report.rows.length,
          to: parsedQuery.to,
          workplaceId: parsedQuery.workplaceId,
        },
        tenantId: currentTenant.tenantId,
      }),
    );

    return file;
  }

  private async buildLegalAttendanceReport(
    currentTenant: CurrentTenantContext,
    query: ParsedLegalAttendanceReportQuery,
  ): Promise<LegalAttendanceReport> {
    const tenant = await this.tenantRepository.findOneBy({
      id: currentTenant.tenantId,
    });

    if (tenant === null) {
      throw new NotFoundException('Tenant not found.');
    }

    const scopedQuery = this.scopeQueryToCurrentUser(currentTenant, query);

    if (scopedQuery.workplaceId !== null) {
      await this.getTenantWorkplace(currentTenant.tenantId, scopedQuery.workplaceId);
    }

    const employees = await this.findReportEmployees(
      currentTenant.tenantId,
      scopedQuery,
    );

    if (scopedQuery.employeeId !== null && employees.length === 0) {
      throw new NotFoundException('Employee not found.');
    }

    const workplaces = await this.findWorkplacesForRows(
      currentTenant.tenantId,
      employees,
      scopedQuery.workplaceId,
    );
    const events = await this.findReportEvents(
      currentTenant.tenantId,
      employees.map((employee) => employee.id),
      scopedQuery.from,
      scopedQuery.to,
    );
    const eventsByEmployeeDay = groupEventsByEmployeeDay({
      employees,
      events,
      includeAdjustments: scopedQuery.includeAdjustments,
      periodFrom: scopedQuery.from,
      periodTo: scopedQuery.to,
      tenantTimezone: tenant.timezone,
      workplaces,
    });
    const dates = getIsoDateRange(scopedQuery.from, scopedQuery.to);
    const rows = employees.flatMap((employee) =>
      dates.map((localDate) =>
        this.buildRow({
          employee,
          events:
            eventsByEmployeeDay.get(getEmployeeDayKey(employee.id, localDate)) ?? [],
          localDate,
          periodFrom: scopedQuery.from,
          periodTo: scopedQuery.to,
          tenant,
          timezone: getEmployeeTimezone(employee, workplaces, tenant.timezone),
          workplaces,
        }),
      ),
    );

    return {
      generatedAt: new Date(),
      includeAdjustments: scopedQuery.includeAdjustments,
      periodFrom: scopedQuery.from,
      periodTo: scopedQuery.to,
      rows,
      tenant,
    };
  }

  private scopeQueryToCurrentUser(
    currentTenant: CurrentTenantContext,
    query: ParsedLegalAttendanceReportQuery,
  ): ParsedLegalAttendanceReportQuery {
    const hasPrivilegedRole = currentTenant.roles.some((role) =>
      privilegedReportRoles.has(role),
    );

    if (hasPrivilegedRole) {
      return query;
    }

    if (
      query.employeeId !== null &&
      query.employeeId !== currentTenant.employeeId
    ) {
      throw new ForbiddenException('Employees can only export their own legal report.');
    }

    if (query.workplaceId !== null) {
      throw new ForbiddenException('Employees cannot export workplace reports.');
    }

    return {
      ...query,
      employeeId: currentTenant.employeeId,
    };
  }

  private async findReportEmployees(
    tenantId: string,
    query: ParsedLegalAttendanceReportQuery,
  ): Promise<EmployeeEntity[]> {
    const where: FindOptionsWhere<EmployeeEntity> = {
      tenantId,
    };

    if (query.employeeId !== null) {
      where.id = query.employeeId;
    } else {
      where.status = In([EmployeeStatus.ACTIVE, EmployeeStatus.INACTIVE]);
    }

    if (query.workplaceId !== null) {
      where.workplaceId = query.workplaceId;
    }

    return this.employeeRepository.find({
      order: {
        displayName: 'ASC',
        id: 'ASC',
      },
      where,
    });
  }

  private async findReportEvents(
    tenantId: string,
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<AttendanceEventEntity[]> {
    if (employeeIds.length === 0) {
      return [];
    }

    const utcWindowStart = new Date(`${from}T00:00:00.000Z`);
    const utcWindowEnd = new Date(`${to}T23:59:59.999Z`);

    utcWindowStart.setUTCDate(utcWindowStart.getUTCDate() - 1);
    utcWindowEnd.setUTCDate(utcWindowEnd.getUTCDate() + 1);

    return this.eventRepository.find({
      order: {
        employeeId: 'ASC',
        occurredAt: 'ASC',
        id: 'ASC',
      },
      where: {
        employeeId: In(employeeIds),
        occurredAt: Between(utcWindowStart, utcWindowEnd),
        tenantId,
      },
    });
  }

  private async findWorkplacesForRows(
    tenantId: string,
    employees: EmployeeEntity[],
    requestedWorkplaceId: string | null,
  ): Promise<Map<string, WorkplaceEntity>> {
    const workplaceIds = new Set<string>();

    if (requestedWorkplaceId !== null) {
      workplaceIds.add(requestedWorkplaceId);
    }

    for (const employee of employees) {
      if (employee.workplaceId !== null) {
        workplaceIds.add(employee.workplaceId);
      }
    }

    if (workplaceIds.size === 0) {
      return new Map();
    }

    const workplaces = await this.workplaceRepository.find({
      where: {
        id: In([...workplaceIds]),
        tenantId,
      },
    });

    return new Map(workplaces.map((workplace) => [workplace.id, workplace]));
  }

  private async getTenantWorkplace(
    tenantId: string,
    workplaceId: string,
  ): Promise<WorkplaceEntity> {
    const workplace = await this.workplaceRepository.findOneBy({
      id: workplaceId,
      tenantId,
    });

    if (workplace === null) {
      throw new NotFoundException('Workplace not found.');
    }

    return workplace;
  }

  private buildRow(input: {
    employee: EmployeeEntity;
    events: AttendanceEventEntity[];
    localDate: string;
    periodFrom: string;
    periodTo: string;
    tenant: TenantEntity;
    timezone: string;
    workplaces: Map<string, WorkplaceEntity>;
  }): LegalAttendanceReportRow {
    const calculation = calculateDailyAttendance(input.events, input.timezone);
    const workplace =
      input.employee.workplaceId === null
        ? null
        : input.workplaces.get(input.employee.workplaceId) ?? null;
    const incidents = [...calculation.incidents];

    if (calculation.adjustmentEventCount > 0) {
      incidents.push('CON_AJUSTES');
    }

    const status = incidents.length === 0 ? 'OK' : 'INCIDENCIA';

    return {
      adjustmentEventCount: calculation.adjustmentEventCount,
      breakMinutes: calculation.breakMinutes,
      employeeEmail: input.employee.email,
      employeeId: input.employee.id,
      employeeName: input.employee.displayName,
      eventCount: calculation.eventCount,
      events: calculation.eventTimeline,
      firstClockIn:
        calculation.firstClockInAt === null
          ? ''
          : formatLocalTime(calculation.firstClockInAt, input.timezone),
      incidents: incidents.join(', '),
      lastClockOut:
        calculation.lastClockOutAt === null
          ? ''
          : formatLocalTime(calculation.lastClockOutAt, input.timezone),
      localDate: input.localDate,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      status,
      tenantLegalName: input.tenant.legalName,
      tenantTaxId: input.tenant.taxId,
      timezone: input.timezone,
      workedHours: Number((calculation.workedMinutes / 60).toFixed(2)),
      workedMinutes: calculation.workedMinutes,
      workplaceId: workplace?.id ?? '',
      workplaceName: workplace?.name ?? 'Sin centro asignado',
    };
  }

  private async renderLegalAttendanceReport(
    report: LegalAttendanceReport,
    format: ReportFormat,
  ): Promise<LegalAttendanceReportFileDto> {
    const baseFilename = `regihora-registro-horario-${report.periodFrom}_${report.periodTo}`;

    if (format === ReportFormat.CSV) {
      return {
        body: renderCsv(report.rows),
        contentType: 'text/csv; charset=utf-8',
        filename: `${baseFilename}.csv`,
        format,
      };
    }

    if (format === ReportFormat.XLSX) {
      return {
        body: await renderXlsx(report),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `${baseFilename}.xlsx`,
        format,
      };
    }

    return {
      body: renderPdf(report),
      contentType: 'application/pdf',
      filename: `${baseFilename}.pdf`,
      format,
    };
  }
}

function parseLegalAttendanceReportQuery(
  query: LegalAttendanceReportQueryDto,
): ParsedLegalAttendanceReportQuery {
  const from = parseIsoDate(query.from, 'from');
  const to = parseIsoDate(query.to, 'to');

  if (to < from) {
    throw new BadRequestException('to must be equal to or later than from.');
  }

  if (getIsoDateRange(from, to).length > 366) {
    throw new BadRequestException('Report period cannot exceed 366 days.');
  }

  return {
    employeeId: parseOptionalSingleString(query.employeeId, 'employeeId'),
    format: parseReportFormat(query.format),
    from,
    includeAdjustments: parseOptionalBoolean(query.includeAdjustments, true),
    to,
    workplaceId: parseOptionalSingleString(query.workplaceId, 'workplaceId'),
  };
}

function parseIsoDate(value: unknown, name: string): string {
  const parsedValue = parseRequiredSingleString(value, name);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsedValue)) {
    throw new BadRequestException(`${name} must be an ISO date.`);
  }

  const date = new Date(`${parsedValue}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsedValue) {
    throw new BadRequestException(`${name} must be a valid ISO date.`);
  }

  return parsedValue;
}

function parseReportFormat(value: unknown): ReportFormat {
  const parsedValue = parseOptionalSingleString(value, 'format') ?? ReportFormat.CSV;
  const allowedValues = Object.values(ReportFormat);

  if (!allowedValues.includes(parsedValue as ReportFormat)) {
    throw new BadRequestException(`format must be one of: ${allowedValues.join(', ')}.`);
  }

  return parsedValue as ReportFormat;
}

function parseOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }
  }

  throw new BadRequestException('includeAdjustments must be a boolean.');
}

function parseRequiredSingleString(value: unknown, name: string): string {
  const parsedValue = parseOptionalSingleString(value, name);

  if (parsedValue === null) {
    throw new BadRequestException(`${name} is required.`);
  }

  return parsedValue;
}

function parseOptionalSingleString(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (Array.isArray(value)) {
    throw new BadRequestException(`${name} must be a single value.`);
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} must be a string.`);
  }

  const trimmedValue = value.trim();

  return trimmedValue.length === 0 ? null : trimmedValue;
}

function groupEventsByEmployeeDay(input: {
  employees: EmployeeEntity[];
  events: AttendanceEventEntity[];
  includeAdjustments: boolean;
  periodFrom: string;
  periodTo: string;
  tenantTimezone: string;
  workplaces: Map<string, WorkplaceEntity>;
}): Map<string, AttendanceEventEntity[]> {
  const employeesById = new Map(
    input.employees.map((employee) => [employee.id, employee]),
  );
  const eventsByEmployeeDay = new Map<string, AttendanceEventEntity[]>();

  for (const event of input.events) {
    if (
      !input.includeAdjustments &&
      event.eventType === AttendanceEventType.ADJUSTMENT
    ) {
      continue;
    }

    const employee = employeesById.get(event.employeeId);

    if (employee === undefined) {
      continue;
    }

    const timezone = getEmployeeTimezone(
      employee,
      input.workplaces,
      input.tenantTimezone,
    );
    const localDate = getEventLocalDate(event, timezone);

    if (localDate < input.periodFrom || localDate > input.periodTo) {
      continue;
    }

    const key = getEmployeeDayKey(event.employeeId, localDate);
    const dayEvents = eventsByEmployeeDay.get(key) ?? [];

    dayEvents.push(event);
    eventsByEmployeeDay.set(key, dayEvents);
  }

  return eventsByEmployeeDay;
}

function calculateDailyAttendance(
  events: AttendanceEventEntity[],
  timezone: string,
): DailyCalculation {
  const sortedEvents = [...events].sort((left, right) => {
    const timeDifference = left.occurredAt.getTime() - right.occurredAt.getTime();

    return timeDifference === 0 ? left.id.localeCompare(right.id) : timeDifference;
  });
  let firstClockInAt: Date | null = null;
  let lastClockOutAt: Date | null = null;
  let activeClockInAt: Date | null = null;
  let activeBreakStartAt: Date | null = null;
  let breakMinutes = 0;
  let workedMinutes = 0;

  for (const event of sortedEvents) {
    if (event.action === PunchAction.CLOCK_IN) {
      activeClockInAt = event.occurredAt;
      activeBreakStartAt = null;
      firstClockInAt = firstClockInAt ?? event.occurredAt;
      continue;
    }

    if (event.action === PunchAction.BREAK_START && activeClockInAt !== null) {
      activeBreakStartAt = event.occurredAt;
      continue;
    }

    if (event.action === PunchAction.BREAK_END && activeBreakStartAt !== null) {
      breakMinutes += getMinutesBetween(activeBreakStartAt, event.occurredAt);
      activeBreakStartAt = null;
      continue;
    }

    if (event.action === PunchAction.CLOCK_OUT && activeClockInAt !== null) {
      workedMinutes += getMinutesBetween(activeClockInAt, event.occurredAt);
      lastClockOutAt = event.occurredAt;
      activeClockInAt = null;
      activeBreakStartAt = null;
    }
  }

  const incidents: string[] = [];

  if (sortedEvents.length === 0) {
    incidents.push('SIN_FICHAJES');
  } else {
    if (activeClockInAt !== null) {
      incidents.push('SESION_ABIERTA');
    }

    if (activeBreakStartAt !== null) {
      incidents.push('PAUSA_ABIERTA');
    }

    if (firstClockInAt === null || lastClockOutAt === null) {
      incidents.push('JORNADA_INCOMPLETA');
    }
  }

  return {
    adjustmentEventCount: sortedEvents.filter(
      (event) => event.eventType === AttendanceEventType.ADJUSTMENT,
    ).length,
    breakMinutes,
    eventCount: sortedEvents.length,
    eventTimeline: sortedEvents
      .map((event) => {
        const adjustmentSuffix =
          event.eventType === AttendanceEventType.ADJUSTMENT ? ' AJUSTE' : '';

        return `${formatLocalTime(event.occurredAt, timezone)} ${event.action} ${event.source}${adjustmentSuffix}`;
      })
      .join(' | '),
    firstClockInAt,
    incidents,
    lastClockOutAt,
    openBreak: activeBreakStartAt !== null,
    openSession: activeClockInAt !== null,
    workedMinutes: Math.max(0, workedMinutes - breakMinutes),
  };
}

function renderCsv(rows: LegalAttendanceReportRow[]): Buffer {
  const header = legalReportColumns.map((column) => column.header);
  const body = rows.map((row) =>
    legalReportColumns.map((column) => csvEscape(row[column.key])).join(';'),
  );

  return Buffer.from(`\uFEFF${[header.map(csvEscape).join(';'), ...body].join('\r\n')}`);
}

async function renderXlsx(report: LegalAttendanceReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'Regihora';
  workbook.created = report.generatedAt;
  workbook.modified = report.generatedAt;

  const worksheet = workbook.addWorksheet('Registro horario');

  worksheet.columns = legalReportColumns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  worksheet.addRows(report.rows);
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: 'A1',
    to: `${getExcelColumnName(legalReportColumns.length)}1`,
  };
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  worksheet.getRow(1).height = 24;
  worksheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function renderPdf(report: LegalAttendanceReport): Buffer {
  const lines = [
    'Registro horario legal',
    `Empresa: ${report.tenant.legalName} | CIF/NIF: ${report.tenant.taxId}`,
    `Periodo: ${report.periodFrom} a ${report.periodTo} | Generado: ${report.generatedAt.toISOString()} | Ajustes: ${report.includeAdjustments ? 'incluidos' : 'excluidos'}`,
    '',
    'Fecha | Empleado | Centro | Entrada | Salida | Min trab. | Min pausa | Estado | Eventos',
    ...report.rows.map((row) =>
      [
        row.localDate,
        row.employeeName,
        row.workplaceName,
        row.firstClockIn || '-',
        row.lastClockOut || '-',
        String(row.workedMinutes),
        String(row.breakMinutes),
        row.status,
        row.events || row.incidents,
      ].join(' | '),
    ),
  ];

  return createSimplePdf(lines);
}

function createSimplePdf(lines: string[]): Buffer {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 32;
  const lineHeight = 11;
  const fontSize = 8;
  const maxLineLength = 150;
  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
  const pages = chunk(
    lines.map((line) => trimText(line, maxLineLength)),
    linesPerPage,
  );
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 2);
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers
      .map((objectNumber) => `${String(objectNumber)} 0 R`)
      .join(' ')}] /Count ${String(pages.length)} >>\nendobj`,
  ];

  pages.forEach((pageLines, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    const content = pageLines
      .map((line, lineIndex) => {
        const y = pageHeight - margin - lineIndex * lineHeight;

        return `BT /F1 ${String(fontSize)} Tf 1 0 0 1 ${String(margin)} ${String(y)} Tm ${encodePdfText(line)} Tj ET`;
      })
      .join('\n');

    objects.push(
      `${String(pageObjectNumber)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(pageWidth)} ${String(pageHeight)}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${String(contentObjectNumber)} 0 R >>\nendobj`,
    );
    objects.push(
      `${String(contentObjectNumber)} 0 obj\n<< /Length ${String(Buffer.byteLength(content))} >>\nstream\n${content}\nendstream\nendobj`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);

  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;

  return Buffer.from(pdf);
}

function getEmployeeTimezone(
  employee: EmployeeEntity,
  workplaces: Map<string, WorkplaceEntity>,
  fallbackTimezone: string,
): string {
  if (employee.workplaceId === null) {
    return fallbackTimezone;
  }

  return workplaces.get(employee.workplaceId)?.timezone ?? fallbackTimezone;
}

function getEventLocalDate(
  event: AttendanceEventEntity,
  fallbackTimezone: string,
): string {
  const metadataLocalDate = event.metadata.localDate;

  if (typeof metadataLocalDate === 'string' && metadataLocalDate.length > 0) {
    return metadataLocalDate;
  }

  const metadataTimezone = event.metadata.timezone;
  const timezone =
    typeof metadataTimezone === 'string' && metadataTimezone.length > 0
      ? metadataTimezone
      : fallbackTimezone;

  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).format(event.occurredAt);
}

function getIsoDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function getMinutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

function formatLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
    timeZone: timezone,
  }).format(date);
}

function getEmployeeDayKey(employeeId: string, localDate: string): string {
  return `${employeeId}:${localDate}`;
}

function csvEscape(value: string | number | boolean): string {
  const str = String(value);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replaceAll('"', '""')}"`;
}

function getExcelColumnName(columnNumber: number): string {
  let remaining = columnNumber;
  let name = '';

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;

    name = String.fromCharCode(65 + modulo) + name;
    remaining = Math.floor((remaining - modulo) / 26);
  }

  return name;
}

function encodePdfText(value: string): string {
  const littleEndian = Buffer.from(`\uFEFF${value}`, 'utf16le');
  const bigEndian = Buffer.alloc(littleEndian.length);

  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1] ?? 0;
    bigEndian[index + 1] = littleEndian[index] ?? 0;
  }

  return `<${bigEndian.toString('hex').toUpperCase()}>`;
}

function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks.length === 0 ? [[]] : chunks;
}
