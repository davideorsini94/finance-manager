import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { CreditCardsService } from './credit-cards.service';

@Controller('credit-cards')
export class CreditCardsController {
  constructor(private readonly creditCardsService: CreditCardsService) {}

  @Get(':accountId/charges')
  charges(
    @CurrentUser() user: AuthUser,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
  ) {
    return this.creditCardsService.listCharges(user.id, accountId);
  }
}
