import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
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

class AddHouseholdMemberDto {
  @IsEmail({}, { message: 'Email non valida' })
  @MaxLength(255)
  email!: string;
}

/** Abitazioni delle bollette: si creano da sole, qui si rinominano, uniscono, eliminano e condividono. */
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

  /** Condivide l'abitazione con un altro account (solo il proprietario). */
  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddHouseholdMemberDto,
  ) {
    return this.service.addMember(user.id, id, dto.email);
  }

  /** Toglie un account; un membro può togliere solo se stesso. */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) memberId: string,
  ) {
    await this.service.removeMember(user.id, id, memberId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.remove(user.id, id);
  }
}
