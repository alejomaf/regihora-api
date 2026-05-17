import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';

import {
  AttendanceEventType,
  AttendanceSource,
  PunchAction,
} from '../../domain/enums';
import { DeviceEntity } from './device.entity';
import { EmployeeEntity } from './employee.entity';
import { TenantEntity } from './tenant.entity';
import { UserEntity } from './user.entity';
import { WorkplaceEntity } from './workplace.entity';

@Entity({ name: 'attendance_events' })
@Index('idx_attendance_events_tenant_occurred_at', ['tenantId', 'occurredAt'])
@Index('idx_attendance_events_employee_occurred_at', ['employeeId', 'occurredAt'])
@Index('uq_attendance_events_qr_challenge', ['tenantId', 'qrChallengeId'], {
  unique: true,
})
@Index('uq_attendance_events_idempotency', ['tenantId', 'createdByUserId', 'idempotencyKey'], {
  unique: true,
})
export class AttendanceEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'workplace_id', type: 'uuid', nullable: true })
  workplaceId!: string | null;

  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId!: string | null;

  @Column({ name: 'adjustment_id', type: 'uuid', nullable: true })
  adjustmentId!: string | null;

  @Column({
    enum: AttendanceEventType,
    enumName: 'attendance_event_type',
    name: 'event_type',
    type: 'enum',
  })
  eventType!: AttendanceEventType;

  @Column({ enum: PunchAction, enumName: 'punch_action', type: 'enum' })
  action!: PunchAction;

  @Column({ enum: AttendanceSource, enumName: 'attendance_source', type: 'enum' })
  source!: AttendanceSource;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'gps_required_by_policy', type: 'boolean', default: false })
  gpsRequiredByPolicy!: boolean;

  @Column({ name: 'gps_provided', type: 'boolean', default: false })
  gpsProvided!: boolean;

  @Column({ name: 'qr_challenge_id', type: 'varchar', length: 128, nullable: true })
  qrChallengeId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.attendanceEvents, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @ManyToOne(() => EmployeeEntity, (employee) => employee.attendanceEvents, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'employee_id' })
  employee!: Relation<EmployeeEntity>;

  @ManyToOne(() => WorkplaceEntity, (workplace) => workplace.attendanceEvents, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'workplace_id' })
  workplace!: Relation<WorkplaceEntity> | null;

  @ManyToOne(() => DeviceEntity, (device) => device.attendanceEvents, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'device_id' })
  device!: Relation<DeviceEntity> | null;

  @ManyToOne(() => UserEntity, (user) => user.createdAttendanceEvents, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser!: Relation<UserEntity>;
}
