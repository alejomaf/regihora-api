import { MigrationInterface, QueryRunner } from 'typeorm';

export class TurnstileDevices1720000000000 implements MigrationInterface {
  name = 'TurnstileDevices1720000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TYPE device_type ADD VALUE IF NOT EXISTS 'TURNSTILE'");
    await queryRunner.query(`
      ALTER TABLE employees
        ADD COLUMN turnstile_code_hash varchar(128)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_employees_tenant_turnstile_code_hash
        ON employees (tenant_id, turnstile_code_hash)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX uq_employees_tenant_turnstile_code_hash');
    await queryRunner.query('ALTER TABLE employees DROP COLUMN turnstile_code_hash');
  }
}
