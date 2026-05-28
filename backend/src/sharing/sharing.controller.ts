import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { SharingService } from './sharing.service';
import {
  AcceptInviteDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
} from './dto/sharing.dto';

@Controller('accounts/:accountId/sharing')
export class AccountSharingController {
  constructor(private readonly service: SharingService) {}

  @Get('members')
  list(@CurrentUser() u: AuthUser, @Param('accountId', new ParseUUIDPipe()) accountId: string) {
    return this.service.listMembers(u.id, accountId);
  }

  @Post('invites')
  invite(
    @CurrentUser() u: AuthUser,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.service.invite(u.id, accountId, dto);
  }

  @Delete('invites/:inviteId')
  revoke(
    @CurrentUser() u: AuthUser,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ) {
    return this.service.revokeInvite(u.id, accountId, inviteId);
  }

  @Post('invites/:inviteId/resend')
  resend(
    @CurrentUser() u: AuthUser,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ) {
    return this.service.resendInvite(u.id, accountId, inviteId);
  }

  @Patch('members/:memberUserId')
  updateRole(
    @CurrentUser() u: AuthUser,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Param('memberUserId', new ParseUUIDPipe()) memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.service.updateMemberRole(u.id, accountId, memberUserId, dto.role);
  }

  @Delete('members/:memberUserId')
  remove(
    @CurrentUser() u: AuthUser,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Param('memberUserId', new ParseUUIDPipe()) memberUserId: string,
  ) {
    return this.service.removeMember(u.id, accountId, memberUserId);
  }

  @Post('transfer-ownership/:newOwnerId')
  transfer(
    @CurrentUser() u: AuthUser,
    @Param('accountId', new ParseUUIDPipe()) accountId: string,
    @Param('newOwnerId', new ParseUUIDPipe()) newOwnerId: string,
  ) {
    return this.service.transferOwnership(u.id, accountId, newOwnerId);
  }
}

/** Endpoint dell'invitato (non scopati per accountId) */
@Controller('invites')
export class InvitesController {
  constructor(private readonly service: SharingService) {}

  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.service.listMyPendingInvites(u.id);
  }

  @Post('accept')
  accept(@CurrentUser() u: AuthUser, @Body() dto: AcceptInviteDto) {
    return this.service.acceptInvite(u.id, dto.token);
  }

  @Post('reject')
  reject(@CurrentUser() u: AuthUser, @Body() dto: AcceptInviteDto) {
    return this.service.rejectInvite(u.id, dto.token);
  }
}
