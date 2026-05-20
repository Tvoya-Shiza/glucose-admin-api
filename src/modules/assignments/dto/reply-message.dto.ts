import { IsString, MaxLength } from 'class-validator';

export class ReplyMessageDto {
    @IsString()
    @MaxLength(4000)
    message!: string;
}
