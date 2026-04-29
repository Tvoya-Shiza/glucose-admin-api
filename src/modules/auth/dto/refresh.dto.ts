import { IsJWT, IsNotEmpty, IsString } from 'class-validator';

export class RefreshDto {
    @IsString()
    @IsNotEmpty()
    @IsJWT()
    refresh_token!: string;
}
