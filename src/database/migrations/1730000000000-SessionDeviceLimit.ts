import { MigrationInterface, QueryRunner } from 'typeorm';

export class SessionDeviceLimit1730000000000 implements MigrationInterface {
  name = 'SessionDeviceLimit1730000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN session_device_limit integer
    `);
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD CONSTRAINT ck_tenants_session_device_limit
        CHECK (
          session_device_limit IS NULL
          OR session_device_limit BETWEEN 1 AND 10
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE tenants DROP CONSTRAINT ck_tenants_session_device_limit',
    );
    await queryRunner.query('ALTER TABLE tenants DROP COLUMN session_device_limit');
  }
}
