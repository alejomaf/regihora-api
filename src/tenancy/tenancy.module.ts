import { Module } from '@nestjs/common';

import { TenantGuard } from './guards/tenant.guard';

@Module({
  exports: [TenantGuard],
  providers: [TenantGuard],
})
export class TenancyModule {}
