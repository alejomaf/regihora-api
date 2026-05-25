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

import { UserEntity } from './user.entity';
import { SupportTicketEntity } from './support-ticket.entity';

@Entity({ name: 'support_ticket_messages' })
@Index('idx_support_ticket_messages_ticket_id', ['ticketId'])
@Index('idx_support_ticket_messages_author_user_id', ['authorUserId'])
@Index('idx_support_ticket_messages_created_at', ['createdAt'])
export class SupportTicketMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string;

  @Column({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId!: string | null;

  @Column({ name: 'author_label', type: 'varchar', length: 160, nullable: true })
  authorLabel!: string | null;

  @Column({ name: 'is_admin', type: 'boolean', default: false })
  isAdmin!: boolean;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => SupportTicketEntity, (ticket) => ticket.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ticket_id' })
  ticket!: Relation<SupportTicketEntity>;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_user_id' })
  authorUser!: Relation<UserEntity> | null;
}
