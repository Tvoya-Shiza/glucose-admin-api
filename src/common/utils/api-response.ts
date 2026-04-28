import { Response } from 'express';

export function apiResponse(success: number, status: string, message: string, data: any = null) {
    const response: any = {
        success: !!success,
        status,
        message,
    };

    if (data !== null) {
        response.data = data;
    }

    return response;
}

export function sendApiResponse(res: Response, status: number, error: string, message: string, data: any = null, httpCode: number = 200) {
    return res.status(httpCode).json(apiResponse(status, error, message, data));
}
