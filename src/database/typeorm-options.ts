import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { EnvironmentVariables } from '../config/environment.validation';
import { databaseEntities } from './entities';
import { InitialSchema1710000000000 } from './migrations/1710000000000-InitialSchema';
import { TurnstileDevices1720000000000 } from './migrations/1720000000000-TurnstileDevices';
import { SessionDeviceLimit1730000000000 } from './migrations/1730000000000-SessionDeviceLimit';
import { BillingIntegration1740000000000 } from './migrations/1740000000000-BillingIntegration';

export function createTypeOrmOptions(
  environment: EnvironmentVariables,
): TypeOrmModuleOptions {
  return createBaseDataSourceOptions(environment);
}

export function createDataSourceOptions(
  environment: EnvironmentVariables,
): DataSourceOptions {
  return {
    ...createBaseDataSourceOptions(environment),
    migrations: [
      InitialSchema1710000000000,
      TurnstileDevices1720000000000,
      SessionDeviceLimit1730000000000,
      BillingIntegration1740000000000,
    ],
  };
}

function createBaseDataSourceOptions(
  environment: EnvironmentVariables,
): PostgresConnectionOptions {
  return {
    database: environment.DATABASE_NAME,
    entities: databaseEntities,
    host: environment.DATABASE_HOST,
    logging: environment.DATABASE_LOGGING,
    migrationsRun: false,
    password: environment.DATABASE_PASSWORD,
    port: environment.DATABASE_PORT,
    ssl: environment.DATABASE_SSL,
    synchronize: false,
    type: 'postgres',
    username: environment.DATABASE_USER,
  };
}
