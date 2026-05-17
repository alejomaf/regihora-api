import { SetMetadata } from '@nestjs/common';

import { UserRole } from '../../domain/enums';

export const ROLES_KEY = 'salidia:roles';

export const Roles = (...roles: UserRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);

