import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmployeeInvitations1760000000000 implements MigrationInterface {
  name = 'EmployeeInvitations1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE employee_invitations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        employee_id uuid NOT NULL,
        invited_by_user_id uuid,
        email varchar(320) NOT NULL,
        token_hash varchar(128) NOT NULL,
        expires_at timestamptz NOT NULL,
        sent_at timestamptz,
        accepted_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_employee_invitations_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT fk_employee_invitations_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        CONSTRAINT fk_employee_invitations_invited_by_user
          FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT uq_employee_invitations_token_hash UNIQUE (token_hash)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_employee_invitations_tenant_employee
        ON employee_invitations (tenant_id, employee_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_employee_invitations_tenant_employee');
    await queryRunner.query('DROP TABLE employee_invitations');
  }
}
