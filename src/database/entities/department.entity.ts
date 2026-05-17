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

import { ResourceStatus } from '../../domain/enums';
import { EmployeeEntity } from './employee.entity';
import { TenantEntity } from './tenant.entity';

@Entity({ name: 'departments' })
@Index('idx_departments_tenant_id', ['tenantId'])
@Index('uq_departments_tenant_name', ['tenantId', 'name'], { unique: true })
export class DepartmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

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

  @ManyToOne(() => TenantEntity, (tenant) => tenant.departments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity>;

  @OneToMany(() => EmployeeEntity, (employee) => employee.department)
  employees!: EmployeeEntity[];
}
