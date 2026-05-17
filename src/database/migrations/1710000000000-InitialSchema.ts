import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1710000000000 implements MigrationInterface {
  name = 'InitialSchema1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await queryRunner.query(
      "CREATE TYPE tenant_plan AS ENUM ('FREE', 'ESSENTIAL', 'PRO', 'BUSINESS', 'ENTERPRISE')",
    );
    await queryRunner.query(
      "CREATE TYPE user_role AS ENUM ('OWNER', 'HR_ADMIN', 'MANAGER', 'EMPLOYEE', 'AUDITOR')",
    );
    await queryRunner.query(
      "CREATE TYPE employee_status AS ENUM ('INVITED', 'ACTIVE', 'INACTIVE')",
    );
    await queryRunner.query(
      "CREATE TYPE resource_status AS ENUM ('ACTIVE', 'INACTIVE')",
    );
    await queryRunner.query(
      "CREATE TYPE work_mode AS ENUM ('IN_PERSON', 'REMOTE', 'HYBRID', 'FIELD')",
    );
    await queryRunner.query(
      "CREATE TYPE attendance_source AS ENUM ('REMOTE', 'IN_PERSON', 'FIXED_DYNAMIC_QR', 'MANUAL_ADJUSTMENT')",
    );
    await queryRunner.query(
      "CREATE TYPE attendance_policy_mode AS ENUM ('REMOTE', 'ONSITE_QR', 'HYBRID')",
    );
    await queryRunner.query(
      "CREATE TYPE punch_action AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END')",
    );
    await queryRunner.query(
      "CREATE TYPE attendance_event_type AS ENUM ('PUNCH', 'ADJUSTMENT')",
    );
    await queryRunner.query(
      "CREATE TYPE device_type AS ENUM ('FIXED_DYNAMIC_QR')",
    );
    await queryRunner.query(
      "CREATE TYPE device_status AS ENUM ('ACTIVE', 'INACTIVE', 'REVOKED')",
    );
    await queryRunner.query(
      "CREATE TYPE adjustment_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED')",
    );

    await queryRunner.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        legal_name varchar(200) NOT NULL,
        tax_id varchar(32) NOT NULL,
        plan tenant_plan NOT NULL DEFAULT 'FREE',
        timezone varchar(64) NOT NULL DEFAULT 'Europe/Madrid',
        locale varchar(16) NOT NULL DEFAULT 'es-ES',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_tenants_tax_id UNIQUE (tax_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(320) NOT NULL,
        password_hash text,
        display_name varchar(160) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_users_email UNIQUE (email)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE workplaces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        mode work_mode NOT NULL,
        timezone varchar(64) NOT NULL DEFAULT 'Europe/Madrid',
        status resource_status NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_workplaces_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT uq_workplaces_tenant_name UNIQUE (tenant_id, name)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        status resource_status NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_departments_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT uq_departments_tenant_name UNIQUE (tenant_id, name)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE policies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        mode attendance_policy_mode NOT NULL,
        geolocation_required boolean NOT NULL DEFAULT false,
        ip_allowlist text[] NOT NULL DEFAULT '{}'::text[],
        allowed_workplace_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
        auto_checkout_enabled boolean NOT NULL DEFAULT false,
        auto_checkout_after_minutes integer,
        status resource_status NOT NULL DEFAULT 'ACTIVE',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_policies_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT uq_policies_tenant_name UNIQUE (tenant_id, name),
        CONSTRAINT ck_policies_auto_checkout_after_minutes
          CHECK (
            auto_checkout_after_minutes IS NULL
            OR auto_checkout_after_minutes BETWEEN 1 AND 1440
          )
      )
    `);

    await queryRunner.query(`
      CREATE TABLE employees (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        user_id uuid,
        workplace_id uuid,
        department_id uuid,
        attendance_policy_id uuid,
        display_name varchar(160) NOT NULL,
        email varchar(320) NOT NULL,
        status employee_status NOT NULL DEFAULT 'INVITED',
        roles user_role[] NOT NULL DEFAULT ARRAY['EMPLOYEE']::user_role[],
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_employees_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT fk_employees_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_employees_workplace
          FOREIGN KEY (workplace_id) REFERENCES workplaces(id) ON DELETE SET NULL,
        CONSTRAINT fk_employees_department
          FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
        CONSTRAINT fk_employees_attendance_policy
          FOREIGN KEY (attendance_policy_id) REFERENCES policies(id)
          ON DELETE SET NULL,
        CONSTRAINT uq_employees_tenant_email UNIQUE (tenant_id, email)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workplace_id uuid NOT NULL,
        public_id varchar(64) NOT NULL,
        type device_type NOT NULL DEFAULT 'FIXED_DYNAMIC_QR',
        name varchar(160) NOT NULL,
        rotation_seconds integer NOT NULL DEFAULT 60,
        status device_status NOT NULL DEFAULT 'INACTIVE',
        enrollment_token_hash varchar(128),
        enrollment_token_expires_at timestamptz,
        device_token_hash varchar(128),
        enrolled_at timestamptz,
        last_heartbeat_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_devices_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT fk_devices_workplace
          FOREIGN KEY (workplace_id) REFERENCES workplaces(id) ON DELETE RESTRICT,
        CONSTRAINT uq_devices_public_id
          UNIQUE (public_id),
        CONSTRAINT uq_devices_tenant_workplace_name
          UNIQUE (tenant_id, workplace_id, name),
        CONSTRAINT uq_devices_enrollment_token_hash
          UNIQUE (enrollment_token_hash),
        CONSTRAINT uq_devices_device_token_hash
          UNIQUE (device_token_hash),
        CONSTRAINT ck_devices_rotation_seconds
          CHECK (rotation_seconds BETWEEN 15 AND 300)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE attendance_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        employee_id uuid NOT NULL,
        workplace_id uuid,
        device_id uuid,
        adjustment_id uuid,
        event_type attendance_event_type NOT NULL,
        action punch_action NOT NULL,
        source attendance_source NOT NULL,
        occurred_at timestamptz NOT NULL,
        gps_required_by_policy boolean NOT NULL DEFAULT false,
        gps_provided boolean NOT NULL DEFAULT false,
        qr_challenge_id varchar(128),
        created_by_user_id uuid NOT NULL,
        idempotency_key varchar(128),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_attendance_events_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_events_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_events_workplace
          FOREIGN KEY (workplace_id) REFERENCES workplaces(id) ON DELETE SET NULL,
        CONSTRAINT fk_attendance_events_device
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
        CONSTRAINT fk_attendance_events_created_by_user
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT uq_attendance_events_qr_challenge
          UNIQUE (tenant_id, qr_challenge_id),
        CONSTRAINT uq_attendance_events_idempotency
          UNIQUE (tenant_id, created_by_user_id, idempotency_key)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        refresh_token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        last_used_at timestamptz,
        ip_address inet,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_sessions_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT uq_sessions_refresh_token_hash UNIQUE (refresh_token_hash)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE adjustments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        employee_id uuid NOT NULL,
        original_event_id uuid,
        resulting_event_id uuid,
        status adjustment_status NOT NULL DEFAULT 'PENDING',
        reason text NOT NULL,
        proposed_action punch_action NOT NULL,
        proposed_occurred_at timestamptz NOT NULL,
        proposed_workplace_id uuid,
        requested_by_user_id uuid NOT NULL,
        requested_at timestamptz NOT NULL,
        decided_by_user_id uuid,
        decided_at timestamptz,
        decision_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_adjustments_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT fk_adjustments_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        CONSTRAINT fk_adjustments_original_event
          FOREIGN KEY (original_event_id) REFERENCES attendance_events(id)
          ON DELETE SET NULL,
        CONSTRAINT fk_adjustments_resulting_event
          FOREIGN KEY (resulting_event_id) REFERENCES attendance_events(id)
          ON DELETE SET NULL,
        CONSTRAINT fk_adjustments_proposed_workplace
          FOREIGN KEY (proposed_workplace_id) REFERENCES workplaces(id)
          ON DELETE SET NULL,
        CONSTRAINT fk_adjustments_requested_by_user
          FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT fk_adjustments_decided_by_user
          FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_adjustments_decision_state CHECK (
          (status = 'PENDING' AND decided_at IS NULL AND decided_by_user_id IS NULL)
          OR
          (status <> 'PENDING' AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(`
      ALTER TABLE attendance_events
        ADD CONSTRAINT fk_attendance_events_adjustment
        FOREIGN KEY (adjustment_id) REFERENCES adjustments(id) ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE attendance_daily_summaries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        employee_id uuid NOT NULL,
        local_date date NOT NULL,
        timezone varchar(80) NOT NULL,
        first_clock_in_at timestamptz,
        last_clock_out_at timestamptz,
        worked_minutes integer NOT NULL DEFAULT 0,
        break_minutes integer NOT NULL DEFAULT 0,
        event_count integer NOT NULL DEFAULT 0,
        open_session boolean NOT NULL DEFAULT false,
        open_break boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_attendance_daily_summaries_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_daily_summaries_employee
          FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        CONSTRAINT uq_attendance_daily_summaries_employee_date
          UNIQUE (tenant_id, employee_id, local_date),
        CONSTRAINT ck_attendance_daily_summaries_minutes
          CHECK (worked_minutes >= 0 AND break_minutes >= 0 AND event_count >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid,
        actor_user_id uuid,
        actor_employee_id uuid,
        entity_type varchar(80) NOT NULL,
        entity_id uuid,
        action varchar(120) NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_audit_logs_tenant
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
        CONSTRAINT fk_audit_logs_actor_user
          FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_audit_logs_actor_employee
          FOREIGN KEY (actor_employee_id) REFERENCES employees(id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query('CREATE INDEX idx_workplaces_tenant_id ON workplaces (tenant_id)');
    await queryRunner.query('CREATE INDEX idx_departments_tenant_id ON departments (tenant_id)');
    await queryRunner.query(
      'CREATE INDEX idx_policies_tenant_id ON policies (tenant_id)',
    );
    await queryRunner.query('CREATE INDEX idx_employees_tenant_id ON employees (tenant_id)');
    await queryRunner.query('CREATE INDEX idx_devices_tenant_id ON devices (tenant_id)');
    await queryRunner.query('CREATE INDEX idx_devices_workplace_id ON devices (workplace_id)');
    await queryRunner.query(
      'CREATE INDEX idx_attendance_events_tenant_occurred_at ON attendance_events (tenant_id, occurred_at)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_attendance_events_employee_occurred_at ON attendance_events (employee_id, occurred_at)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_attendance_daily_summaries_tenant_date ON attendance_daily_summaries (tenant_id, local_date)',
    );
    await queryRunner.query('CREATE INDEX idx_sessions_user_id ON sessions (user_id)');
    await queryRunner.query(
      'CREATE INDEX idx_adjustments_tenant_status ON adjustments (tenant_id, status)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_adjustments_employee_id ON adjustments (employee_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_audit_logs_tenant_occurred_at ON audit_logs (tenant_id, occurred_at)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE audit_logs');
    await queryRunner.query('DROP TABLE attendance_daily_summaries');
    await queryRunner.query(
      'ALTER TABLE attendance_events DROP CONSTRAINT fk_attendance_events_adjustment',
    );
    await queryRunner.query('DROP TABLE adjustments');
    await queryRunner.query('DROP TABLE sessions');
    await queryRunner.query('DROP TABLE attendance_events');
    await queryRunner.query('DROP TABLE devices');
    await queryRunner.query('DROP TABLE employees');
    await queryRunner.query('DROP TABLE policies');
    await queryRunner.query('DROP TABLE departments');
    await queryRunner.query('DROP TABLE workplaces');
    await queryRunner.query('DROP TABLE users');
    await queryRunner.query('DROP TABLE tenants');

    await queryRunner.query('DROP TYPE adjustment_status');
    await queryRunner.query('DROP TYPE device_status');
    await queryRunner.query('DROP TYPE device_type');
    await queryRunner.query('DROP TYPE attendance_event_type');
    await queryRunner.query('DROP TYPE punch_action');
    await queryRunner.query('DROP TYPE attendance_policy_mode');
    await queryRunner.query('DROP TYPE attendance_source');
    await queryRunner.query('DROP TYPE work_mode');
    await queryRunner.query('DROP TYPE resource_status');
    await queryRunner.query('DROP TYPE employee_status');
    await queryRunner.query('DROP TYPE user_role');
    await queryRunner.query('DROP TYPE tenant_plan');
  }
}
