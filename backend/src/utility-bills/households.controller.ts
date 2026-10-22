import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { HouseholdsService } from './households.service';

class RenameHouseholdDto {
  @IsString()
  @MinLength(1, { message: 'Il nome non può essere vuoto' })
  @MaxLength(120)
  name!: string;
}

class MergeHouseholdDto {
  @IsUUID('4', { message: 'Abitazione non valida' })
  intoId!: string;
}

/** Abitazioni delle bollette: si creano da sole, qui si rinominano, uniscono, eliminano. */
@Controller('households')
export class HouseholdsController {
  constructor(private readonly service: HouseholdsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.id);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenameHouseholdDto,
  ) {
    return this.service.rename(user.id, id, dto.name);
  }

  @Post(':id/merge')
  merge(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MergeHouseholdDto,
  ) {
    return this.service.merge(user.id, id, dto.intoId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.remove(user.id, id);
  }
}
