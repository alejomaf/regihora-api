import { BadRequestException } from '@nestjs/common';

export type PageOptions = {
  limit: number;
  offset: number;
};

export function parsePageOptions(query: {
  limit?: unknown;
  cursor?: unknown;
}): PageOptions {
  const limit = parseInteger(query.limit, 50, 'limit');
  const offset = parseInteger(query.cursor, 0, 'cursor');

  if (limit < 1 || limit > 200) {
    throw new BadRequestException('limit must be between 1 and 200.');
  }

  if (offset < 0) {
    throw new BadRequestException('cursor must be zero or greater.');
  }

  return {
    limit,
    offset,
  };
}

export function getNextCursor(
  offset: number,
  returnedCount: number,
  totalCount: number,
): string | null {
  const nextOffset = offset + returnedCount;

  return nextOffset < totalCount ? String(nextOffset) : null;
}

export function parseRequiredString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  const parsedValue = parseOptionalString(value, name, maxLength);

  if (parsedValue === undefined) {
    throw new BadRequestException(`${name} is required.`);
  }

  return parsedValue;
}

export function parseOptionalString(
  value: unknown,
  name: string,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${name} must be a string.`);
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return undefined;
  }

  if (trimmedValue.length > maxLength) {
    throw new BadRequestException(`${name} must be at most ${String(maxLength)} characters.`);
  }

  return trimmedValue;
}

export function parseRequiredEmail(value: unknown): string {
  const email = parseRequiredString(value, 'email', 320).toLowerCase();

  if (!email.includes('@')) {
    throw new BadRequestException('email must be valid.');
  }

  return email;
}

export function parseOptionalNullableString(
  value: unknown,
  name: string,
  maxLength: number,
): string | null | undefined {
  if (value === null) {
    return null;
  }

  return parseOptionalString(value, name, maxLength);
}

export function parseEnumValue<T extends string>(
  value: unknown,
  enumObject: Record<string, T>,
  name: string,
): T {
  const parsedValue = parseRequiredString(value, name, 120);
  const allowedValues = Object.values(enumObject);

  if (!allowedValues.includes(parsedValue as T)) {
    throw new BadRequestException(`${name} must be one of: ${allowedValues.join(', ')}.`);
  }

  return parsedValue as T;
}

export function parseOptionalEnumValue<T extends string>(
  value: unknown,
  enumObject: Record<string, T>,
  name: string,
): T | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return parseEnumValue(value, enumObject, name);
}

export function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }
  }

  throw new BadRequestException('sendInvitations must be a boolean.');
}

function parseInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    throw new BadRequestException(`${name} must be a single integer.`);
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue)) {
    throw new BadRequestException(`${name} must be an integer.`);
  }

  return parsedValue;
}
