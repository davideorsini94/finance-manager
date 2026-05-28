import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UsersService } from './users.service';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  locale?: string;
}

class SetFavoriteAccountDto {
  /** `null` per rimuovere il preferito, altrimenti uuid del conto. */
  @ValidateIf((o: SetFavoriteAccountDto) => o.accountId !== null)
  @IsUUID()
  accountId!: string | null;
}

@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.findById(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  /**
   * Imposta (o rimuove con `accountId: null`) il conto preferito per l'utente
   * loggato. Il conto deve essere accessibile in lettura all'utente.
   */
  @Put('me/favorite-account')
  setFavoriteAccount(@CurrentUser() user: AuthUser, @Body() dto: SetFavoriteAccountDto) {
    return this.usersService.setFavoriteAccount(user.id, dto.accountId);
  }

  @Get()
  list(@Query('q') q?: string) {
    return this.usersService.list(q);
  }

  @Roles(UserRole.admin)
  @Delete(':id')
  deactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.deactivate(id);
  }
}
