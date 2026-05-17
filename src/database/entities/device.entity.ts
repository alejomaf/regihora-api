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

import { DeviceStatus, DeviceType } from '../../domain/enums';
import { AttendanceEventEntity } from './attendance-event.entity';
import { TenantEntity } from './tenant.entity';
import { WorkplaceEntity } from './workplace.entity';

@Entity({ name: 'devices' })
@Index('idx_devices_tenant_id', ['tenantId'])
@Index('idx_devices_workplace_id', ['workplaceId'])
@Index('uq_devices_public_id', ['publicId'], { unique: true })
@Index('uq_devices_enrollment_token_hash', ['enrollmentTokenHash'], { unique: true })
@Index('uq_devices_device_token_hash', ['deviceTokenHash'], { unique: true })
@Index('uq_devices_tenant_workplace_name', ['tenantId', 'workplaceId', 'name'], {
  unique: true,
})
export class DeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workplace_id', type: 'uuid' })
  workplaceId!: string;

  @Column({ name: 'public_id', type: 'varchar', length: 64 })
  publicId!: string;

  @Column({
    default: DeviceType.FIXED_DYNAMIC_QR,
    enum: DeviceType,
    enumName: 'device_type',
    type: 'enum',
  })
  type!: DeviceType;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'rotation_seconds', type: 'integer', default: 60 })
  rotationSeconds!: number;

  @Column({
    default: DeviceStatus.INACTIVE,
    enum: DeviceStatus,
    enumName: 'device_status',
    type: 'enum',
  })
  status!: DeviceStatus;

  @Column({ name: 'enrollment_token_hash', type: 'varchar', length: 128, nullable: true })
  enrollmentTokenHash!: string | null;

  @Column({ name: 'enrollment_token_expires_at', type: 'timestamptz', nullable: true })
  enrollmentTokenExpiresAt!: Date | null;

  @Column({ name: 'device_token_hash', type: 'varchar', length: 128, nullable: true })
  deviceTokenHash!: string | null;

  @Column({ name: 'enrolled_at', type: 'timestamptz', nullable: true })
  enrolledAt!: Date | null;

  @Column({ name: 'last_heartbeat_at', type: 'timestamptz', nullable: true })
  lastHeartbeatAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.devices, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @ManyToOne(() => WorkplaceEntity, (workplace) => workplace.devices, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'workplace_id' })
  workplace!: Relation<WorkplaceEntity>;

  @OneToMany(() => AttendanceEventEntity, (event) => event.device)
  attendanceEvents!: AttendanceEventEntity[];
}
