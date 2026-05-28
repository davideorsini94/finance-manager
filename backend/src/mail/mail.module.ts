import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { SmtpSettingsController } from './smtp-settings.controller';

@Global()
@Module({
  controllers: [SmtpSettingsController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
