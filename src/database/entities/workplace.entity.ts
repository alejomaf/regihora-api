import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';

import { ResourceStatus, WorkMode } from '../../domain/enums';
import { AttendanceAdjustmentEntity } from './attendance-adjustment.entity';
import { AttendanceEventEntity } from './attendance-event.entity';
import { DeviceEntity } from './device.entity';
import { EmployeeEntity } from './employee.entity';
import { TenantEntity } from './tenant.entity';

@Entity({ name: 'workplaces' })
@Index('idx_workplaces_tenant_id', ['tenantId'])
@Index('uq_workplaces_tenant_name', ['tenantId', 'name'], { unique: true })
export class WorkplaceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ enum: WorkMode, enumName: 'work_mode', type: 'enum' })
  mode!: WorkMode;

  @Column({ default: 'Europe/Madrid', type: 'varchar', length: 64 })
  timezone!: string;

  @Column({
    default: ResourceStatus.ACTIVE,
    enum: ResourceStatus,
    enumName: 'resource_status',
    type: 'enum',
  })
  status!: ResourceStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.workplaces, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @OneToMany(() => EmployeeEntity, (employee) => employee.workplace)
  employees!: EmployeeEntity[];

  @OneToMany(() => DeviceEntity, (device) => device.workplace)
  devices!: DeviceEntity[];

  @OneToMany(() => AttendanceEventEntity, (event) => event.workplace)
  attendanceEvents!: AttendanceEventEntity[];

  @OneToMany(() => AttendanceAdjustmentEntity, (adjustment) => adjustment.proposedWorkplace)
  proposedAdjustments!: AttendanceAdjustmentEntity[];
}
