import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AttendanceAdjustmentEntity } from './attendance-adjustment.entity';
import { AttendanceEventEntity } from './attendance-event.entity';
import { AuditLogEntity } from './audit-log.entity';
import { EmployeeEntity } from './employee.entity';
import { SessionEntity } from './session.entity';

@Entity({ name: 'users' })
@Index('uq_users_email', ['email'], { unique: true })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash!: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => EmployeeEntity, (employee) => employee.user)
  employees!: EmployeeEntity[];

  @OneToMany(() => SessionEntity, (session) => session.user)
  sessions!: SessionEntity[];

  @OneToMany(() => AttendanceEventEntity, (event) => event.createdByUser)
  createdAttendanceEvents!: AttendanceEventEntity[];

  @OneToMany(() => AttendanceAdjustmentEntity, (adjustment) => adjustment.requestedByUser)
  requestedAdjustments!: AttendanceAdjustmentEntity[];

  @OneToMany(() => AttendanceAdjustmentEntity, (adjustment) => adjustment.decidedByUser)
  decidedAdjustments!: AttendanceAdjustmentEntity[];

  @OneToMany(() => AuditLogEntity, (auditLog) => auditLog.actorUser)
  auditLogs!: AuditLogEntity[];
}

