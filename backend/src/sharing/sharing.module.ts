import { Module } from '@nestjs/common';
import { SharingService } from './sharing.service';
import { AccountSharingController, InvitesController } from './sharing.controller';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [CategoriesModule],
  controllers: [AccountSharingController, InvitesController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
