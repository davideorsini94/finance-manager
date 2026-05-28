import { Global, Module } from '@nestjs/common';
import { AccountPolicyService } from './services/account-policy.service';
import { AuditService } from './services/audit.service';
import { CryptoService } from './services/crypto.service';

@Global()
@Module({
  providers: [AccountPolicyService, AuditService, CryptoService],
  exports: [AccountPolicyService, AuditService, CryptoService],
})
export class CommonModule {}
