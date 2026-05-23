# Regihora API

NestJS backend API for Regihora.

## Requirements

- Node.js 22+
- npm 10+

## Setup

```sh
npm install
cp .env.example .env
```

## Environment

Supported variables:

- `NODE_ENV`: `development`, `test`, or `production`.
- `PORT`: HTTP port. Defaults to `3000`.
- `SERVICE_NAME`: service identifier used in health responses and logs.
- `LOG_LEVEL`: Nest logger level: `error`, `warn`, `log`, `debug`, or `verbose`.
- `DATABASE_ENABLED`: set `false` to skip PostgreSQL connection, defaults to `false` in tests and `true` otherwise.
- `DATABASE_HOST`: PostgreSQL host.
- `DATABASE_PORT`: PostgreSQL port.
- `DATABASE_NAME`: PostgreSQL database name.
- `DATABASE_USER`: PostgreSQL user.
- `DATABASE_PASSWORD`: PostgreSQL password.
- `DATABASE_SSL`: set `true` for TLS connections.
- `DATABASE_LOGGING`: set `true` to enable TypeORM query logging.

Environment files are loaded in this order:

1. `.env.${NODE_ENV}.local`
2. `.env.${NODE_ENV}`
3. `.env.local`
4. `.env`

## Commands

```sh
npm run start:dev
npm run lint
npm run test
npm run test:e2e
npm run build
npm run check
```

## Database

The API uses TypeORM with PostgreSQL and explicit migrations. `synchronize` is disabled.

Initial tables:

- `tenants`
- `users`
- `employees`
- `workplaces`
- `policies`
- `devices`
- `attendance_events`
- `sessions`
- `adjustments`
- `audit_logs`

Run pending migrations:

```sh
npm run migration:run
```

Show migration state:

```sh
npm run migration:show
```

Revert the last migration:

```sh
npm run migration:revert
```

## Health

```sh
curl http://localhost:3000/health
```
