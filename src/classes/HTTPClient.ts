import type { MaybePromise } from "bun";
import * as JSONv2 from "json-bigint-native";
import {
	type AnyError,
	GENERIC_CHALLENGE_ID_HEADER,
	GENERIC_CHALLENGE_METADATA_HEADER,
	GENERIC_CHALLENGE_TYPE_HEADER,
	type ParsedChallenge,
	parseBEDEV1Error,
	parseBEDEV2Error,
	parseChallengeHeaders,
} from "parse-roblox-errors";
import type { HBAClient } from "roblox-bat";
import {
	CSRF_TOKEN_HEADER_NAME,
	DEFAULT_ACCOUNT_TOKEN,
	RATELIMIT_LIMIT_HEADER,
	RATELIMIT_REMAINING_HEADER,
	RATELIMIT_RESET_HEADER,
	REMOVE_PROTOCOL_REGEX,
	RETRY_ERROR_CODES,
	USER_AGENT_HEADER_NAME,
} from "../constants.ts";
import { canParseURL, filterObject } from "../utils.ts";
import {
	type AnyHTTPRequest,
	type CamelizeObjectFn,
	HTTPResponse,
} from "./HTTPResponse.ts";
import { RESTError } from "./RESTError.ts";

export type HTTPMethod =
	| "GET"
	| "POST"
	| "PATCH"
	| "PUT"
	| "DELETE"
	| "OPTIONS";

export type ExpectContentType =
	| "json"
	| "jsonWithBigInts"
	| "text"
	| "arrayBuffer"
	| "blob"
	| "formData"
	| "dom"
	| "none";

export type FormDataSetRequest = {
	value: string | Blob;
	fileName?: string;
};

export type HTTPRequestBodyContent =
	| {
			type: "json" | "jsonWithBigInts";
			value: unknown;
	  }
	| {
			type: "text";
			value: string;
	  }
	| {
			type: "formdata";
			value: Record<string, FormDataSetRequest>;
	  }
	| {
			type: "file";
			value: Uint8Array;
	  }
	| {
			type: "urlencoded";
			value: URLSearchParams | Record<string, string>;
	  }
	| {
			type: "unknown";
			value: unknown;
	  };

export type InternalHTTPRequest<T extends string> = {
	method?: HTTPMethod;
	url: string;
	search?: Record<string, unknown> | URLSearchParams;
	headers?: Record<string, unknown> | Headers;
	body?: HTTPRequestBodyContent;
	expect?: ExpectContentType;
	includeCredentials?: boolean;
	camelizeResponse?: boolean;
	cache?: RequestCache;
	bypassCORS?: boolean;
	accountToken?: string | number;
	overrideDeviceType?: T;
};

export type HTTPRequest<T extends string> = InternalHTTPRequest<T> & {
	includeCsrf?: boolean;
	retries?: number;
	errorHandling?: "BEDEV1" | "BEDEV2" | "none";
	handleChallenge?: (
		challenge: ParsedChallenge,
	) => MaybePromise<ParsedChallenge | undefined>;
};

export type HTTPClientDomains = {
	main: string;
	cdn: string;
};

export type HTTPClientConstructorOptions<T extends string> = {
	domains: HTTPClientDomains;

	hbaClient?: HBAClient;
	onWebsite?: boolean;

	fetch?: (typeof globalThis)["fetch"];
	bypassCORSFetch?: (typeof globalThis)["fetch"];
	camelizeObject?: CamelizeObjectFn;

	overrideDeviceTypeHeaderName?: string;
	overrideDeviceTypeToUserAgent?: Record<T, string>;

	trackingUserAgent?: string;
	trackingSearchParam?: string;

	accountTokenSearchParam?: string;

	isDev?: boolean;
};

export default class HTTPClient<T extends string = string> {
	private _options: HTTPClientConstructorOptions<T>;

	public csrfTokens: {
		accounts: Record<string, MaybePromise<string | undefined>>;
		ip: MaybePromise<string | undefined>;
	} = {
		accounts: {},
		ip: undefined,
	};

	constructor(options: HTTPClientConstructorOptions<T>) {
		this._options = options;
	}

	public getCsrfToken(
		authorized = false,
		accountToken: string | number = DEFAULT_ACCOUNT_TOKEN,
	): MaybePromise<string | undefined> {
		let token: MaybePromise<string | undefined>;
		if (authorized) {
			token = this.csrfTokens.accounts[accountToken];
		} else {
			token = this.csrfTokens.ip;
		}

		if (
			accountToken === DEFAULT_ACCOUNT_TOKEN &&
			authorized &&
			!token &&
			this._options.onWebsite
		) {
			token =
				globalThis.document
					?.querySelector('[name="csrf-token"]')
					?.getAttribute("data-token") || undefined;
		}

		return token;
	}

	public setCsrfToken(
		value: MaybePromise<string | undefined>,
		authorized?: boolean,
		accountToken: string | number = DEFAULT_ACCOUNT_TOKEN,
	) {
		if (authorized) {
			this.csrfTokens.accounts[accountToken] = value;
		}

		this.csrfTokens.ip = value;
	}

	public async handleRequestHeaders(
		request: InternalHTTPRequest<T>,
		contentType?: string,
		newBody?: Uint8Array | BodyInit,
	) {
		const newHeaders = new Headers(
			!request.headers || request.headers instanceof Headers
				? request.headers
				: (filterObject(request.headers) as Record<string, string>),
		);

		if (request.overrideDeviceType) {
			if (
				this._options.overrideDeviceTypeToUserAgent &&
				!this._options.overrideDeviceTypeHeaderName
			) {
				newHeaders.set(
					USER_AGENT_HEADER_NAME,
					this._options.overrideDeviceTypeToUserAgent[
						request.overrideDeviceType
					],
				);
			}
		} else if (
			this._options.trackingUserAgent &&
			!this._options.trackingSearchParam
		) {
			newHeaders.set(USER_AGENT_HEADER_NAME, this._options.trackingUserAgent);
		}

		if (this._options.hbaClient) {
			const hbaHeaders = await this._options.hbaClient.generateBaseHeaders(
				request.url.toString(),
				request.method,
				request.includeCredentials,
				newBody,
			);

			for (const key in hbaHeaders) {
				newHeaders.set(key, hbaHeaders[key] as string);
			}
		}

		if (contentType) newHeaders.set("content-type", contentType);

		return newHeaders;
	}

	public formatRequestUrl(request: AnyHTTPRequest<T>, protocol = "https"): URL {
		if (request.url.includes(this._options.domains.cdn)) {
			return canParseURL(request.url)
				? new URL(request.url)
				: new URL(
						`${protocol}://${request.url.replace(REMOVE_PROTOCOL_REGEX, "")}`,
					);
		}
		const url = request.url;
		let search = request.search ?? new URLSearchParams();
		if (search && !(search instanceof URLSearchParams)) {
			// Filter undefined & null values
			search = new URLSearchParams(
				filterObject(search) as Record<string, string>,
			);
		}

		if (request.accountToken && this._options.accountTokenSearchParam) {
			search.set(
				this._options.accountTokenSearchParam,
				request.accountToken.toString(),
			);
		}

		if (request.overrideDeviceType) {
			if (this._options.overrideDeviceTypeHeaderName) {
				search.set(
					this._options.overrideDeviceTypeHeaderName,
					request.overrideDeviceType,
				);
			}
		} else if (this._options.trackingSearchParam) {
			search.set(this._options.trackingSearchParam, "");
		}

		const formattedUrl =
			url.startsWith("/") ||
			(canParseURL(url) && this._options.isDev && !url.startsWith("localhost:"))
				? new URL(url, location.href)
				: new URL(`${protocol}://${url.replace(REMOVE_PROTOCOL_REGEX, "")}`);
		for (const [key, value] of search) {
			formattedUrl.searchParams.append(key, value);
		}

		// Force http if requesting localhost
		if (
			this._options.isDev &&
			formattedUrl.hostname === "localhost" &&
			formattedUrl.protocol === "https:"
		) {
			formattedUrl.protocol = "http:";
		}

		return formattedUrl;
	}

	public formatBody(body: HTTPRequestBodyContent): {
		body: string | URLSearchParams | Uint8Array | FormData | BodyInit;
		type?: string;
	} {
		let newBody:
			| string
			| URLSearchParams
			| Uint8Array
			| FormData
			| BodyInit
			| undefined;
		let contentType: string | undefined;

		switch (body.type) {
			case "formdata": {
				const formdata = new FormData();
				for (const name in body.value) {
					const value = body.value[name] as FormDataSetRequest;

					value.fileName
						? formdata.set(name, value.value as Blob, value.fileName)
						: formdata.set(name, value.value);
				}
				newBody = formdata;
				break;
			}

			case "json": {
				newBody = JSON.stringify(body.value);
				contentType = "application/json";
				break;
			}

			case "urlencoded": {
				newBody = new URLSearchParams(body.value);
				contentType = "application/x-www-form-urlencoded";
				break;
			}

			case "unknown": {
				newBody = body.value as BodyInit;
				break;
			}

			case "jsonWithBigInts": {
				newBody = JSONv2.stringify(body.value);
				contentType = "application/json";
				break;
			}

			default: {
				newBody = body.value;
				break;
			}
		}

		return {
			body: newBody,
			type: contentType,
		};
	}

	public async _httpRequest<U = unknown>(
		request: InternalHTTPRequest<T>,
	): Promise<HTTPResponse<U>> {
		// handle URL
		const url = this.formatRequestUrl(request);
		let newBody:
			| string
			| URLSearchParams
			| Uint8Array
			| FormData
			| BodyInit
			| undefined;
		let contentType: string | undefined;

		if (request.body) {
			// handle body
			const formattedBody = this.formatBody(request.body);
			newBody = formattedBody.body;
			contentType = formattedBody.type;
		}

		const headers = await this.handleRequestHeaders(
			request,
			contentType,
			newBody ?? undefined,
		);

		const requestInfo = filterObject({
			method: request.method ?? "GET",
			headers,
			cache: request.cache,
			body: newBody,
		}) as RequestInit;

		if (request.includeCredentials) {
			requestInfo.credentials = "include";
		} else if (request.includeCredentials === false) {
			requestInfo.credentials = "omit";
		}

		const response = await (request.bypassCORS && this._options.bypassCORSFetch
			? this._options.bypassCORSFetch
			: (this._options.fetch ?? fetch))(url.toString(), requestInfo);

		return await HTTPResponse.init<U, T>(
			request,
			response as Response,
			undefined,
			this._options.camelizeObject,
		);
	}

	public parseRatelimitHeaders(headers: Headers): Ratelimit | undefined {
		if (!headers.has(RATELIMIT_LIMIT_HEADER)) return;

		return {
			_limit: headers.get(RATELIMIT_LIMIT_HEADER) as string,
			remaining: Number.parseInt(
				headers.get(RATELIMIT_REMAINING_HEADER) as string,
				10,
			),
			reset: Number.parseInt(headers.get(RATELIMIT_RESET_HEADER) as string, 10),
		};
	}

	public async httpRequest<U = unknown>(
		request: HTTPRequest<T>,
	): Promise<HTTPResponse<U>> {
		const method = request.method ?? "GET";
		const errorHandling = request.errorHandling ?? "BEDEV1";

		// handle initial headers
		let filteredHeaders = request.headers ?? {};
		if (!(filteredHeaders instanceof Headers)) {
			filteredHeaders = filterObject(filteredHeaders);
		}
		const headers = new Headers(
			filteredHeaders as Headers | Record<string, string>,
		);

		const isRobloxApiRequest = request.url
			.toString()
			.includes(this._options.domains.main);

		// handle regular CSRF tokens
		if (
			isRobloxApiRequest &&
			(request.includeCsrf ??
				(request.includeCsrf === undefined && method !== "GET"))
		) {
			const csrfToken = await this.getCsrfToken(
				request.includeCredentials,
				request.accountToken,
			);

			if (csrfToken) {
				headers.set(CSRF_TOKEN_HEADER_NAME, csrfToken);
			}
		}

		let retries = request.retries;
		while (true) {
			const response = await this._httpRequest<void>({
				...request,
				expect: "none",
				headers,
			});

			if (
				isRobloxApiRequest &&
				response.status.code === 403 &&
				response.headers.has(CSRF_TOKEN_HEADER_NAME)
			) {
				const csrfToken = response.headers.get(
					CSRF_TOKEN_HEADER_NAME,
				) as string;

				this.setCsrfToken(
					csrfToken,
					request.includeCredentials,
					request.accountToken,
				);
				headers.set(CSRF_TOKEN_HEADER_NAME, csrfToken);

				continue;
			}

			const ratelimitHeaders = this.parseRatelimitHeaders(response.headers);
			if (
				isRobloxApiRequest &&
				!response.status.ok &&
				request.handleChallenge
			) {
				const parsedChallenge = parseChallengeHeaders(response.headers);

				if (parsedChallenge) {
					const newChallenge = await request.handleChallenge(parsedChallenge);
					if (newChallenge) {
						headers.set(
							GENERIC_CHALLENGE_TYPE_HEADER,
							newChallenge.challengeType,
						);
						headers.set(GENERIC_CHALLENGE_ID_HEADER, newChallenge.challengeId);
						headers.set(
							GENERIC_CHALLENGE_METADATA_HEADER,
							newChallenge.challengeBase64Metadata,
						);

						continue;
					}
				}
			}

			if (request.errorHandling !== "none" && !response.status.ok) {
				if (
					retries &&
					retries > 0 &&
					RETRY_ERROR_CODES.includes(response.status.code)
				) {
					retries--;
					continue;
				}

				// send errors to console
				const errors = await (errorHandling === "BEDEV1"
					? parseBEDEV1Error
					: parseBEDEV2Error)(response._response);

				let errorsAsString = "";
				for (const error of errors) {
					let errorAsString = "";
					for (const key in error) {
						const value = error[key as keyof typeof error];
						const valueAsString = Array.isArray(value)
							? JSON.stringify(value)
							: value;

						errorAsString += `${key}: "${valueAsString}"`;
					}

					errorsAsString += `${errorsAsString ? "\n" : ""}${errorAsString}`;
				}

				throw new RESTError(
					`HTTP ${response.status.code} from ${request.method ?? "GET"} ${response.url}${
						errorsAsString
							? `\n\n${request.errorHandling ?? "BEDEV1"} errors:\n${errorsAsString}`
							: ""
					}`,
					true,
					errors as AnyError[],
					response.status.code,
					response,
					ratelimitHeaders,
				);
			}

			return HTTPResponse.init<U, T>(
				request,
				response._response,
				ratelimitHeaders,
				this._options.camelizeObject,
			);
		}
	}
}

export type Ratelimit = {
	_limit: string;
	remaining: number;
	reset: number;
};
