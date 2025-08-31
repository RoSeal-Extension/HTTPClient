import * as JSONv2 from "json-bigint-native";
import type {
	HTTPRequest,
	InternalHTTPRequest,
	Ratelimit,
} from "./HTTPClient.tsx";

export type HTTPResponseStatus = {
	ok: boolean;
	code: number;
	text: string;
};

export type AnyHTTPRequest<T extends string> =
	| InternalHTTPRequest<T>
	| HTTPRequest<T>;

export type CamelizeObjectFn = (
	input: unknown,
	options: { deep: boolean; pascalCase: boolean },
	// biome-ignore lint/suspicious/noExplicitAny: fine
) => any;

export class HTTPResponse<T = unknown, U extends string = string> {
	public static async parseBody<T, U extends string>(
		request: AnyHTTPRequest<U>,
		response: Response,
		camelizeObject?: CamelizeObjectFn,
	): Promise<T> {
		if (
			request.expect === "none" ||
			response.headers.get("content-length") === "0" ||
			response.status === 204
		) {
			return undefined as T;
		}

		let body: T | undefined;

		const clone = response.clone();
		if (
			request.expect === "json" ||
			!request.expect ||
			request.expect === "jsonWithBigInts"
		) {
			body = (await clone.text().then((text) => {
				const trimmed = text.trim();
				if (request.expect === "jsonWithBigInts") {
					return JSONv2.parse(trimmed);
				}
				return JSON.parse(trimmed);
			})) as T;

			if (request.camelizeResponse && camelizeObject) {
				body = camelizeObject(body, {
					pascalCase: false,
					deep: true,
				});
			}

			return body as T;
		}

		if (request.expect === "dom") {
			return new DOMParser().parseFromString(
				await clone.text(),
				"text/html",
			) as T;
		}

		return clone[request.expect]() as Promise<T>;
	}

	public static async init<T, U extends string>(
		request: AnyHTTPRequest<U>,
		response: Response,
		ratelimit?: Ratelimit,
		camelizeObject?: CamelizeObjectFn,
	): Promise<HTTPResponse<T>> {
		const body = await HTTPResponse.parseBody<T, U>(
			request,
			response,
			camelizeObject,
		);

		return new HTTPResponse<T>(request, response, body, ratelimit);
	}

	public readonly status: HTTPResponseStatus;
	public readonly headers: Headers;
	public readonly url: string;
	public readonly redirected: boolean;
	public readonly _response: Response;

	constructor(
		public readonly _request: AnyHTTPRequest<U>,
		response: Response,
		public readonly body: T,
		public readonly ratelimit?: Ratelimit,
	) {
		this._response = response;

		this.status = {
			ok: response.ok,
			code: response.status,
			text: response.statusText,
		};
		this.headers = response.headers;
		this.url = response.url;
		this.redirected = response.redirected;
	}
}
