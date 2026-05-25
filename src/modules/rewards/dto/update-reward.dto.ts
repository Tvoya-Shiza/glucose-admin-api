import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateRewardDto {
    @IsOptional()
    @IsInt()
    @Min(0)
    score?: number;

    @IsOptional()
    @IsIn(['active', 'disabled'])
    status?: 'active' | 'disabled';
}
