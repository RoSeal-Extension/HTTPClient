import * as JSONv2 from "json-bigint-native";
import { CONTENT_LENGTH_HEADER_NAME } from "../constants.ts";
import type {
	HTTPRequest,
	HTTPRequestExpectType,
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
		defaultExpect?: HTTPRequestExpectType,
		camelizeObject?: CamelizeObjectFn,
	): Promise<T> {
		const expect = request.expect ?? defaultExpect;
		if (
			request.ignoreExpect ||
			expect?.type === "none" ||
			response.headers.get(CONTENT_LENGTH_HEADER_NAME) === "0" ||
			response.status === 204
		) {
			return undefined as T;
		}

		let body: T | undefined;

		const clone = response.clone();

		if (
			expect?.type === "json" ||
			!expect ||
			expect?.type === "jsonWithBigInts"
		) {
			body = (await clone.text().then((text) => {
				const trimmed = text.trim();
				if (request.expect?.type === "jsonWithBigInts") {
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

		if (expect.type === "dom") {
			return new DOMParser().parseFromString(
				await clone.text(),
				"text/html",
			) as T;
		}

		if (expect.type === "readableStream") {
			return clone.body as T;
		}

		const type = expect.type === "protobuf" ? "arrayBuffer" : expect.type;

		return clone[type]() as Promise<T>;
	}

	public static async init<T, U extends string>(
		request: AnyHTTPRequest<U>,
		response: Response,
		defaultExpect?: HTTPRequestExpectType,
		ratelimit?: Ratelimit,
		camelizeObject?: CamelizeObjectFn,
	): Promise<HTTPResponse<T>> {
		const body = await HTTPResponse.parseBody<T, U>(
			request,
			response,
			defaultExpect,
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
