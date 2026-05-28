import { Global, Module } from '@nestjs/common';
import { CreditCardsController } from './credit-cards.controller';
import { CreditCardsService } from './credit-cards.service';

@Global()
@Module({
  controllers: [CreditCardsController],
  providers: [CreditCardsService],
  exports: [CreditCardsService],
})
export class CreditCardsModule {}
