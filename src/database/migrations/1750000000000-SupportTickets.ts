import { MigrationInterface, QueryRunner } from 'typeorm';

export class SupportTickets1750000000000 implements MigrationInterface {
  name = 'SupportTickets1750000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE support_ticket_status AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')",
    );
    await queryRunner.query(
      "CREATE TYPE support_ticket_priority AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT')",
    );
    await queryRunner.query(`
      CREATE TABLE support_tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid,
        user_id uuid,
        subject varchar(220) NOT NULL,
        description text,
        status support_ticket_status NOT NULL DEFAULT 'OPEN',
        priority support_ticket_priority NOT NULL DEFAULT 'NORMAL',
        category varchar(80),
        source varchar(80) NOT NULL DEFAULT 'admin_hub',
        resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_support_tickets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
        CONSTRAINT fk_support_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE TABLE support_ticket_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id uuid NOT NULL,
        author_user_id uuid,
        author_label varchar(160),
        is_admin boolean NOT NULL DEFAULT false,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_support_ticket_messages_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
        CONSTRAINT fk_support_ticket_messages_user FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_support_tickets_tenant_status ON support_tickets (tenant_id, status)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_support_tickets_user_id ON support_tickets (user_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_support_tickets_created_at ON support_tickets (created_at)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_support_ticket_messages_ticket_id ON support_ticket_messages (ticket_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_support_ticket_messages_author_user_id ON support_ticket_messages (author_user_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_support_ticket_messages_created_at ON support_ticket_messages (created_at)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_support_ticket_messages_created_at');
    await queryRunner.query('DROP INDEX idx_support_ticket_messages_author_user_id');
    await queryRunner.query('DROP INDEX idx_support_ticket_messages_ticket_id');
    await queryRunner.query('DROP INDEX idx_support_tickets_created_at');
    await queryRunner.query('DROP INDEX idx_support_tickets_user_id');
    await queryRunner.query('DROP INDEX idx_support_tickets_tenant_status');
    await queryRunner.query('DROP TABLE support_ticket_messages');
    await queryRunner.query('DROP TABLE support_tickets');
    await queryRunner.query('DROP TYPE support_ticket_priority');
    await queryRunner.query('DROP TYPE support_ticket_status');
  }
}
