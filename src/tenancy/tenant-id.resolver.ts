import type { Request } from 'express';

import { TENANT_ID_FIELD, TENANT_ID_HEADER } from './constants';

type TenantIdSource = {
  source: string;
  value: string;
};

export type TenantIdResolution =
  | {
      status: 'resolved';
      tenantId: string;
      sources: TenantIdSource[];
    }
  | {
      status: 'missing';
      sources: TenantIdSource[];
    }
  | {
      status: 'conflicting';
      sources: TenantIdSource[];
    };

export function resolveTenantId(request: Request): TenantIdResolution {
  const sources = collectTenantIdSources(request);
  const uniqueTenantIds = [...new Set(sources.map((source) => source.value))];

  const tenantId = uniqueTenantIds[0];

  if (tenantId === undefined) {
    return {
      sources,
      status: 'missing',
    };
  }

  if (uniqueTenantIds.length > 1) {
    return {
      sources,
      status: 'conflicting',
    };
  }

  return {
    sources,
    status: 'resolved',
    tenantId,
  };
}

function collectTenantIdSources(request: Request): TenantIdSource[] {
  return [
    ...makeSources('header:X-Regihora-Tenant-Id', request.headers[TENANT_ID_HEADER]),
    ...makeSources('param:tenantId', request.params.tenantId),
    ...makeSources(`param:${TENANT_ID_FIELD}`, request.params[TENANT_ID_FIELD]),
    ...makeSources(`query:${TENANT_ID_FIELD}`, request.query[TENANT_ID_FIELD]),
    ...makeSources('query:tenantId', request.query.tenantId),
    ...makeBodySources(request.body),
  ];
}

function makeBodySources(body: unknown): TenantIdSource[] {
  if (!isRecord(body)) {
    return [];
  }

  return [
    ...makeSources(`body:${TENANT_ID_FIELD}`, body[TENANT_ID_FIELD]),
    ...makeSources('body:tenantId', body.tenantId),
  ];
}

function makeSources(source: string, value: unknown): TenantIdSource[] {
  return getStringValues(value).map((tenantId) => ({
    source,
    value: tenantId,
  }));
}

function getStringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmedValue = value.trim();

    return trimmedValue.length > 0 ? [trimmedValue] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(getStringValues);
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
