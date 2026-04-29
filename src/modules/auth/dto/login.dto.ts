import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
    @IsString()
    @IsNotEmpty({ message: 'admin.auth.email_required' })
    @IsEmail({}, { message: 'admin.auth.email_invalid' })
    @MaxLength(255)
    email!: string;

    @IsString()
    @IsNotEmpty({ message: 'admin.auth.password_required' })
    @MinLength(1)
    @MaxLength(1024)
    password!: string;
}
