import { IsEmail } from 'class-validator';

export class InviteDto {
  @IsEmail()
  email!: string;
}
