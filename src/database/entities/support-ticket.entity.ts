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

import { SupportTicketPriority, SupportTicketStatus } from '../../domain/enums';
import { TenantEntity } from './tenant.entity';
import { UserEntity } from './user.entity';
import { SupportTicketMessageEntity } from './support-ticket-message.entity';

@Entity({ name: 'support_tickets' })
@Index('idx_support_tickets_tenant_status', ['tenantId', 'status'])
@Index('idx_support_tickets_user_id', ['userId'])
@Index('idx_support_tickets_created_at', ['createdAt'])
export class SupportTicketEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 220 })
  subject!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    default: SupportTicketStatus.OPEN,
    enum: SupportTicketStatus,
    enumName: 'support_ticket_status',
    type: 'enum',
  })
  status!: SupportTicketStatus;

  @Column({
    default: SupportTicketPriority.NORMAL,
    enum: SupportTicketPriority,
    enumName: 'support_ticket_priority',
    type: 'enum',
  })
  priority!: SupportTicketPriority;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category!: string | null;

  @Column({ type: 'varchar', length: 80, default: 'admin_hub' })
  source!: string;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => TenantEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Relation<TenantEntity> | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user!: Relation<UserEntity> | null;

  @OneToMany(() => SupportTicketMessageEntity, (message) => message.ticket)
  messages!: SupportTicketMessageEntity[];
}
