import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';

import { EmployeeEntity } from './employee.entity';
import { TenantEntity } from './tenant.entity';

@Entity({ name: 'attendance_daily_summaries' })
@Index('uq_attendance_daily_summaries_employee_date', ['tenantId', 'employeeId', 'localDate'], {
  unique: true,
})
@Index('idx_attendance_daily_summaries_tenant_date', ['tenantId', 'localDate'])
export class AttendanceDailySummaryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'local_date', type: 'date' })
  localDate!: string;

  @Column({ type: 'varchar', length: 80 })
  timezone!: string;

  @Column({ name: 'first_clock_in_at', type: 'timestamptz', nullable: true })
  firstClockInAt!: Date | null;

  @Column({ name: 'last_clock_out_at', type: 'timestamptz', nullable: true })
  lastClockOutAt!: Date | null;

  @Column({ name: 'worked_minutes', type: 'integer', default: 0 })
  workedMinutes!: number;

  @Column({ name: 'break_minutes', type: 'integer', default: 0 })
  breakMinutes!: number;

  @Column({ name: 'event_count', type: 'integer', default: 0 })
  eventCount!: number;

  @Column({ name: 'open_session', type: 'boolean', default: false })
  openSession!: boolean;

  @Column({ name: 'open_break', type: 'boolean', default: false })
  openBreak!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @ManyToOne(() => EmployeeEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Relation<EmployeeEntity>;
}
