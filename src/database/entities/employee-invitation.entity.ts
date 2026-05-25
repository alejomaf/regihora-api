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

import { EmployeeEntity } from './employee.entity';
import { TenantEntity } from './tenant.entity';
import { UserEntity } from './user.entity';

@Entity({ name: 'employee_invitations' })
@Index('idx_employee_invitations_tenant_employee', ['tenantId', 'employeeId'])
@Index('uq_employee_invitations_token_hash', ['tokenHash'], { unique: true })
export class EmployeeInvitationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId!: string;

  @Column({ name: 'invited_by_user_id', type: 'uuid', nullable: true })
  invitedByUserId!: string | null;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 128 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.employeeInvitations, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @ManyToOne(() => EmployeeEntity, (employee) => employee.invitations, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'employee_id' })
  employee!: Relation<EmployeeEntity>;

  @ManyToOne(() => UserEntity, (user) => user.sentEmployeeInvitations, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'invited_by_user_id' })
  invitedByUser!: Relation<UserEntity> | null;
}
