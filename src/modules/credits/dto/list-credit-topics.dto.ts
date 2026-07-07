import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/** Query DTO for GET /admin-api/v1/admin/credit-topics. */
export class ListCreditTopicsDto {
    /** `?include_archived=true` also returns archived topics. Omit for active only. */
    @IsOptional()
    @Transform(({ value }) => {
        if (value === true || value === 'true' || value === '1' || value === 1) return true;
        if (value === false || value === 'false' || value === '0' || value === 0) return false;
        return undefined;
    })
    @IsBoolean()
    include_archived?: boolean;
}
