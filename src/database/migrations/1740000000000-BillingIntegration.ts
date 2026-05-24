import { MigrationInterface, QueryRunner } from 'typeorm';

export class BillingIntegration1740000000000 implements MigrationInterface {
  name = 'BillingIntegration1740000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "CREATE TYPE billing_status AS ENUM ('FREE', 'CHECKOUT_REQUIRED', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'UNPAID')",
    );
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN billing_status billing_status NOT NULL DEFAULT 'FREE',
        ADD COLUMN stripe_customer_id varchar(255),
        ADD COLUMN stripe_subscription_id varchar(255),
        ADD COLUMN stripe_price_id varchar(255),
        ADD COLUMN billing_current_period_end timestamptz,
        ADD COLUMN trial_ends_at timestamptz
    `);
    await queryRunner.query(
      'ALTER TABLE tenants ADD CONSTRAINT uq_tenants_stripe_customer_id UNIQUE (stripe_customer_id)',
    );
    await queryRunner.query(
      'ALTER TABLE tenants ADD CONSTRAINT uq_tenants_stripe_subscription_id UNIQUE (stripe_subscription_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_tenants_billing_status ON tenants (billing_status)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_tenants_billing_status');
    await queryRunner.query(
      'ALTER TABLE tenants DROP CONSTRAINT uq_tenants_stripe_subscription_id',
    );
    await queryRunner.query(
      'ALTER TABLE tenants DROP CONSTRAINT uq_tenants_stripe_customer_id',
    );
    await queryRunner.query(`
      ALTER TABLE tenants
        DROP COLUMN trial_ends_at,
        DROP COLUMN billing_current_period_end,
        DROP COLUMN stripe_price_id,
        DROP COLUMN stripe_subscription_id,
        DROP COLUMN stripe_customer_id,
        DROP COLUMN billing_status
    `);
    await queryRunner.query('DROP TYPE billing_status');
  }
}
