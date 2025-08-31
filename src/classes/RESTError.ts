import type { AnyError } from "parse-roblox-errors";
import type { Ratelimit } from "./HTTPClient";
import type { HTTPResponse } from "./HTTPResponse";

export class RESTError extends Error {
    constructor(
        message: string,
        public isHttpError = false,
        public errors?: AnyError[],
        public httpCode?: number,
        public response?: HTTPResponse,
        public ratelimit?: Ratelimit,
    ) {
        super(message);
    }
}