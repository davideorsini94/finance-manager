import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsEnum, IsString, ValidateNested } from 'class-validator';
import { AccountRole } from '@prisma/client';

export class InviteMemberDto {
  @IsEmail() email!: string;
  @IsEnum(AccountRole) role!: AccountRole;
}

export class BulkInviteDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InviteMemberDto)
  invites!: InviteMemberDto[];
}

export class UpdateMemberRoleDto {
  @IsEnum(AccountRole) role!: AccountRole;
}

export class AcceptInviteDto {
  @IsString() token!: string;
}
