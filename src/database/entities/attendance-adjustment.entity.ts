import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';

import { AdjustmentStatus, PunchAction } from '../../domain/enums';
import { AttendanceEventEntity } from './attendance-event.entity';
import { EmployeeEntity } from './employee.entity';
import { TenantEntity } from './tenant.entity';
import { UserEntity } from './user.entity';
import { WorkplaceEntity } from './workplace.entity';

@Entity({ name: 'adjustments' })
@Index('idx_adjustments_tenant_status', ['tenantId', 'status'])
@Index('idx_adjustments_employee_id', ['employeeId'])
export class AttendanceAdjustmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'original_event_id', type: 'uuid', nullable: true })
  originalEventId!: string | null;

  @Column({ name: 'resulting_event_id', type: 'uuid', nullable: true })
  resultingEventId!: string | null;

  @Column({
    default: AdjustmentStatus.PENDING,
    enum: AdjustmentStatus,
    enumName: 'adjustment_status',
    type: 'enum',
  })
  status!: AdjustmentStatus;

  @Column({ type: 'text' })
  reason!: string;

  @Column({
    enum: PunchAction,
    enumName: 'punch_action',
    name: 'proposed_action',
    type: 'enum',
  })
  proposedAction!: PunchAction;

  @Column({ name: 'proposed_occurred_at', type: 'timestamptz' })
  proposedOccurredAt!: Date;

  @Column({ name: 'proposed_workplace_id', type: 'uuid', nullable: true })
  proposedWorkplaceId!: string | null;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  requestedByUserId!: string;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  decidedByUserId!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @Column({ name: 'decision_reason', type: 'text', nullable: true })
  decisionReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.adjustments, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @ManyToOne(() => EmployeeEntity, (employee) => employee.adjustments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'employee_id' })
  employee!: Relation<EmployeeEntity>;

  @ManyToOne(() => AttendanceEventEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'original_event_id' })
  originalEvent!: Relation<AttendanceEventEntity> | null;

  @ManyToOne(() => AttendanceEventEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resulting_event_id' })
  resultingEvent!: Relation<AttendanceEventEntity> | null;

  @ManyToOne(() => WorkplaceEntity, (workplace) => workplace.proposedAdjustments, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'proposed_workplace_id' })
  proposedWorkplace!: Relation<WorkplaceEntity> | null;

  @ManyToOne(() => UserEntity, (user) => user.requestedAdjustments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'requested_by_user_id' })
  requestedByUser!: Relation<UserEntity>;

  @ManyToOne(() => UserEntity, (user) => user.decidedAdjustments, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'decided_by_user_id' })
  decidedByUser!: Relation<UserEntity> | null;
}
