export const nodeEnvironments = ['development', 'test', 'production'] as const;
export const logLevels = ['error', 'warn', 'log', 'debug', 'verbose'] as const;

export type NodeEnvironment = (typeof nodeEnvironments)[number];
export type AppLogLevel = (typeof logLevels)[number];

export type EnvironmentVariables = {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  SERVICE_NAME: string;
  LOG_LEVEL: AppLogLevel;
  DATABASE_ENABLED: boolean;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_NAME: string;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_SSL: boolean;
  DATABASE_LOGGING: boolean;
  JWT_ACCESS_TOKEN_SECRET: string;
  JWT_ACCESS_TOKEN_TTL_SECONDS: number;
  JWT_REFRESH_TOKEN_TTL_SECONDS: number;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  CORS_ALLOWED_ORIGINS: string[];
};

type RawEnvironment = Record<string, unknown>;

export function validateEnvironment(config: RawEnvironment): EnvironmentVariables {
  const nodeEnvironment = parseEnumValue(
    config.NODE_ENV,
    nodeEnvironments,
    'NODE_ENV',
    'development',
  );
  const port = parsePort(config.PORT);
  const serviceName = parseNonEmptyString(
    config.SERVICE_NAME,
    'SERVICE_NAME',
    'salidia-api',
  );
  const logLevel = parseEnumValue(config.LOG_LEVEL, logLevels, 'LOG_LEVEL', 'log');
  const databaseEnabled = parseBoolean(
    config.DATABASE_ENABLED,
    'DATABASE_ENABLED',
    nodeEnvironment !== 'test',
  );
  const defaultCorsOrigins =
    nodeEnvironment === 'production'
      ? ''
      : 'http://localhost:4200,http://127.0.0.1:4200';

  return {
    CORS_ALLOWED_ORIGINS: parseStringList(
      config.CORS_ALLOWED_ORIGINS,
      defaultCorsOrigins,
    ),
    DATABASE_ENABLED: databaseEnabled,
    DATABASE_HOST: parseNonEmptyString(
      config.DATABASE_HOST,
      'DATABASE_HOST',
      'localhost',
    ),
    DATABASE_LOGGING: parseBoolean(
      config.DATABASE_LOGGING,
      'DATABASE_LOGGING',
      false,
    ),
    DATABASE_NAME: parseNonEmptyString(
      config.DATABASE_NAME,
      'DATABASE_NAME',
      'salidia',
    ),
    DATABASE_PASSWORD: parseNonEmptyString(
      config.DATABASE_PASSWORD,
      'DATABASE_PASSWORD',
      'change-me-local-only',
    ),
    DATABASE_PORT: parsePort(config.DATABASE_PORT, 'DATABASE_PORT'),
    DATABASE_SSL: parseBoolean(config.DATABASE_SSL, 'DATABASE_SSL', false),
    DATABASE_USER: parseNonEmptyString(
      config.DATABASE_USER,
      'DATABASE_USER',
      'salidia',
    ),
    JWT_ACCESS_TOKEN_SECRET: parseSecret(
      config.JWT_ACCESS_TOKEN_SECRET,
      'JWT_ACCESS_TOKEN_SECRET',
      nodeEnvironment,
    ),
    JWT_ACCESS_TOKEN_TTL_SECONDS: parsePositiveInteger(
      config.JWT_ACCESS_TOKEN_TTL_SECONDS,
      'JWT_ACCESS_TOKEN_TTL_SECONDS',
      900,
    ),
    JWT_AUDIENCE: parseNonEmptyString(
      config.JWT_AUDIENCE,
      'JWT_AUDIENCE',
      'salidia',
    ),
    JWT_ISSUER: parseNonEmptyString(
      config.JWT_ISSUER,
      'JWT_ISSUER',
      'salidia-api',
    ),
    JWT_REFRESH_TOKEN_TTL_SECONDS: parsePositiveInteger(
      config.JWT_REFRESH_TOKEN_TTL_SECONDS,
      'JWT_REFRESH_TOKEN_TTL_SECONDS',
      2_592_000,
    ),
    LOG_LEVEL: logLevel,
    NODE_ENV: nodeEnvironment,
    PORT: port,
    SERVICE_NAME: serviceName,
  };
}

function parsePort(value: unknown, name = 'PORT'): number {
  const rawPort = value ?? '3000';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  return port;
}

function parseBoolean(value: unknown, name: string, fallback: boolean): boolean {
  const rawValue = value ?? String(fallback);

  if (typeof rawValue === 'boolean') {
    return rawValue;
  }

  if (typeof rawValue !== 'string') {
    throw new Error(`${name} must be a boolean.`);
  }

  if (rawValue === 'true') {
    return true;
  }

  if (rawValue === 'false') {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function parsePositiveInteger(
  value: unknown,
  name: string,
  fallback: number,
): number {
  const rawValue = value ?? String(fallback);
  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsedValue;
}

function parseSecret(
  value: unknown,
  name: string,
  nodeEnvironment: NodeEnvironment,
): string {
  const secret = parseNonEmptyString(value, name, `change-me-${name.toLowerCase()}`);

  if (nodeEnvironment === 'production' && secret.startsWith('change-me-')) {
    throw new Error(`${name} must be set to a production secret.`);
  }

  return secret;
}

function parseNonEmptyString(
  value: unknown,
  name: string,
  fallback: string,
): string {
  const rawValue = value ?? fallback;

  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return rawValue.trim();
}

function parseStringList(value: unknown, fallback: string): string[] {
  const rawValue = value ?? fallback;

  if (typeof rawValue !== 'string') {
    throw new Error('CORS_ALLOWED_ORIGINS must be a comma-separated string.');
  }

  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  name: string,
  fallback: T[number],
): T[number] {
  const rawValue = value ?? fallback;

  if (typeof rawValue !== 'string') {
    throw new Error(`${name} must be a string.`);
  }

  if (!allowedValues.includes(rawValue)) {
    throw new Error(`${name} must be one of: ${allowedValues.join(', ')}.`);
  }

  return rawValue;
}
