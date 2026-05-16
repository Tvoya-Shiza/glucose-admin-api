export interface FolderDto {
    id: number;
    parent_id: number | null;
    name: string;
    slug: string;
    path: string;
    created_by: number;
    created_at: string;
    updated_at: string;
    children_count: number;
    files_count: number;
}

export interface ListFoldersResponseDto {
    data: FolderDto[];
}

export interface FolderBreadcrumb {
    id: number;
    name: string;
    slug: string;
    path: string;
}

export interface FolderDetailResponseDto {
    folder: FolderDto;
    breadcrumbs: FolderBreadcrumb[];
}
