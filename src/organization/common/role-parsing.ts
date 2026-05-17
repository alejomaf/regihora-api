import { BadRequestException } from '@nestjs/common';

import { UserRole } from '../../domain/enums';

const userRoleValues = new Set<string>(Object.values(UserRole));

export function parseRoles(value: unknown, fallback?: UserRole[]): UserRole[] {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new BadRequestException('roles is required.');
  }

  const roleValues = Array.isArray(value)
    ? value
    : parseRoleListString(value);

  if (roleValues.length === 0) {
    throw new BadRequestException('roles must include at least one role.');
  }

  const roles = roleValues.map((role) => {
    if (typeof role !== 'string' || !userRoleValues.has(role)) {
      throw new BadRequestException(
        `roles must contain only: ${Object.values(UserRole).join(', ')}.`,
      );
    }

    return role as UserRole;
  });

  return [...new Set(roles)];
}

function parseRoleListString(value: unknown): string[] {
  if (typeof value !== 'string') {
    throw new BadRequestException('roles must be an array or delimited string.');
  }

  return value
    .split(/[;,|]/)
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}
