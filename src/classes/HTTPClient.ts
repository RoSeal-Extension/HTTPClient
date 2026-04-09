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
	ACCEPT_CONTENT_TYPE_HEADER_NAME,
	CLOUD_API_KEY_HEADER_NAME,
	CONTENT_TYPE_HEADER_NAME,
	COOKIE_HEADER_NAME,
	CSRF_TOKEN_HEADER_NAME,
	DEFAULT_ACCOUNT_TOKEN,
	INTERNAL_API_KEY_HEADER_NAME,
	OAUTH_AUTHORIZATION_HEADER_NAME,
	ORIGIN_HEADER_NAME,
	RATELIMIT_LIMIT_HEADER,
	RATELIMIT_REMAINING_HEADER,
	RATELIMIT_RESET_HEADER,
	REFERER_HEADER_NAME,
	REMOVE_PROTOCOL_REGEX,
	RETRY_ERROR_CODES,
	ROBLOX_DEPRECATION_MESSAGE_HEADER_NAME,
	USER_AGENT_HEADER_NAME,
} from "../constants.ts";
import { canParseURL, filterObject } from "../utils/utils.ts";
import {
	type AnyHTTPRequest,
	type CamelizeObjectFn,
	HTTPResponse,
} from "./HTTPResponse.ts";
import { RESTError } from "./RESTError.ts";
import {
	type CookieJar,
	parseSetCookieHeaders,
	type Cookie,
} from "./CookieJar.ts";

export type BareHBAClient = {
	generateBaseHeaders: HBAClient["generateBaseHeaders"];
};

export type AccountTokenType = string | number | bigint;

export type HTTPMethod =
	| "GET"
	| "POST"
	| "PATCH"
	| "PUT"
	| "DELETE"
	| "OPTIONS";

export type HTTPRequestExpectType =
	| { type: "json" }
	| { type: "jsonWithBigInts" }
	| { type: "text" }
	| { type: "arrayBuffer" }
	| { type: "blob" }
	| { type: "formData" }
	| { type: "dom" }
	| { type: "protobuf" }
	| {
			type: "readableStream";
	  }
	| { type: "none" };

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

export type HTTPRequestCredentials =
	| {
			type: "cookies";
			value: boolean;
	  }
	| {
			type: "internalApiKey";
			value: string;
	  }
	| {
			type: "openCloudApiKey";
			value: string;
	  }
	| {
			type: "bearerToken";
			value: string;
	  };

export type InternalHTTPRequest<T extends string> = {
	method?: HTTPMethod;
	url: string;
	search?: Record<string, unknown> | URLSearchParams;
	headers?: Record<string, unknown> | Headers;
	body?: HTTPRequestBodyContent;
	expect?: HTTPRequestExpectType;
	ignoreExpect?: boolean;
	credentials?: HTTPRequestCredentials;
	camelizeResponse?: boolean;
	cache?: RequestCache;
	bypassCORS?: boolean;
	accountToken?: AccountTokenType;
	overridePlatformType?: T;
	signal?: AbortSignal;
	redirect?: RequestRedirect;
	integrity?: string;
	keepalive?: boolean;
	mode?: RequestMode;
	priority?: RequestPriority;
	referrer?: string;
	referrerPolicy?: ReferrerPolicy;
	window?: null;
	skipTrackingSearchParam?: boolean;
	skipAddingCookies?: boolean;
	skipCheckingSetCookie?: boolean;
};

export type HTTPRequest<T extends string> = InternalHTTPRequest<T> & {
	includeCsrf?: boolean;
	retries?: number;
	errorHandling?: "BEDEV1" | "BEDEV2" | "none";
	handleChallenge?: (
		challenge: ParsedChallenge,
		request: InternalHTTPRequest<T>,
	) => MaybePromise<ParsedChallenge | undefined>;
};

export type HTTPClientDomains = {
	main: string;
	cdn: string;
};

export type HTTPClientConstructorOptions<T extends string> = {
	domains: HTTPClientDomains;

	disallowedHBAAccountTokens?: AccountTokenType[];
	hbaClient?: BareHBAClient;
	onWebsite?: boolean;

	fetch?: (typeof globalThis)["fetch"];
	bypassCORSFetch?: (typeof globalThis)["fetch"];
	camelizeObject?: CamelizeObjectFn;

	defaultAccountToken?: AccountTokenType;
	defaultExpect?: HTTPRequestExpectType;
	defaultOrigin?: string;
	defaultReferer?: string;

	jars?: Map<AccountTokenType, CookieJar>;

	defaultOverridePlatformType?: T;
	overridePlatformTypeSearchParam?: string;
	overridePlatformTypeToUserAgent?: Record<T, string>;

	trackingUserAgent?: string;
	trackingSearchParam?: string;

	accountTokenSearchParam?: string;

	isDev?: boolean;

	handleChallenge?: (
		challenge: ParsedChallenge,
		request: InternalHTTPRequest<T>,
	) => MaybePromise<ParsedChallenge | undefined>;
	onDeprecationMessage?: (
		request: HTTPRequest<T>,
		response: HTTPResponse,
		message: string,
	) => void;
	onCookiesUpdated?: (
		accountToken: AccountTokenType,
		cookies: Cookie[],
	) => undefined | false;
};

export default class HTTPClient<T extends string = string> {
	private _options: HTTPClientConstructorOptions<T>;

	public disallowedHBAAccountTokens: Set<AccountTokenType> = new Set();
	public jars: Map<AccountTokenType, CookieJar> | undefined;
	public csrfTokens: {
		accounts: Map<AccountTokenType, MaybePromise<string | undefined>>;
		ip: MaybePromise<string | undefined>;
	} = {
		accounts: new Map(),
		ip: undefined,
	};

	constructor(options: HTTPClientConstructorOptions<T>) {
		this._options = options;
		this.jars = options.jars;

		if (options.disallowedHBAAccountTokens)
			this.disallowedHBAAccountTokens = new Set(
				options.disallowedHBAAccountTokens,
			);
	}

	public updateOptions(options: Partial<HTTPClientConstructorOptions<T>>) {
		this._options = {
			...this._options,
			...options,
		};

		if (this._options.jars) this.jars = this._options.jars;
	}

	public getUserAgent(requestOverridePlatformType?: T): string | null {
		const overridePlatformType =
			requestOverridePlatformType || this._options.defaultOverridePlatformType;
		if (
			overridePlatformType &&
			this._options.overridePlatformTypeToUserAgent &&
			!this._options.overridePlatformTypeSearchParam
		) {
			const userAgent =
				this._options.overridePlatformTypeToUserAgent[overridePlatformType];

			if (userAgent) return userAgent;
		}

		return null;
	}

	public getCsrfToken(
		authorized = false,
		accountToken: AccountTokenType = DEFAULT_ACCOUNT_TOKEN,
	): MaybePromise<string | undefined> {
		let token: MaybePromise<string | undefined>;
		if (authorized) {
			token = this.csrfTokens.accounts.get(accountToken);
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
		accountToken: AccountTokenType = DEFAULT_ACCOUNT_TOKEN,
	) {
		if (authorized) {
			this.csrfTokens.accounts.set(accountToken, value);
		}

		this.csrfTokens.ip = value;
	}

	public async handleRequestHeaders(
		request: InternalHTTPRequest<T>,
		contentType?: string,
		newBody?: Uint8Array | BodyInit,
		cookieJar?: CookieJar,
	): Promise<Headers> {
		const newHeaders = new Headers(
			!request.headers || request.headers instanceof Headers
				? request.headers
				: (filterObject(request.headers) as Record<string, string>),
		);

		if (request.credentials) {
			switch (request.credentials.type) {
				case "bearerToken": {
					newHeaders.set(
						OAUTH_AUTHORIZATION_HEADER_NAME,
						`Bearer ${request.credentials.value}`,
					);
					break;
				}
				case "internalApiKey": {
					newHeaders.set(
						INTERNAL_API_KEY_HEADER_NAME,
						request.credentials.value,
					);
					break;
				}
				case "openCloudApiKey": {
					newHeaders.set(CLOUD_API_KEY_HEADER_NAME, request.credentials.value);
					break;
				}
			}
		}

		if (!newHeaders.has(ORIGIN_HEADER_NAME) && this._options.defaultOrigin) {
			newHeaders.set(ORIGIN_HEADER_NAME, this._options.defaultOrigin);
		}

		if (!newHeaders.has(REFERER_HEADER_NAME) && this._options.defaultReferer) {
			newHeaders.set(REFERER_HEADER_NAME, this._options.defaultReferer);
		}

		if (!newHeaders.has(USER_AGENT_HEADER_NAME)) {
			const userAgent = this.getUserAgent(request.overridePlatformType);

			if (userAgent) {
				newHeaders.set(USER_AGENT_HEADER_NAME, userAgent);
			} else if (
				this._options.trackingUserAgent &&
				!this._options.trackingSearchParam &&
				!newHeaders.has(USER_AGENT_HEADER_NAME)
			) {
				newHeaders.set(USER_AGENT_HEADER_NAME, this._options.trackingUserAgent);
			}
		}

		if (cookieJar) {
			const cookiesStr = cookieJar.getCookieStringFromURL(new URL(request.url));

			if (!newHeaders.has(COOKIE_HEADER_NAME))
				newHeaders.set(COOKIE_HEADER_NAME, cookiesStr);
		}

		const accountToken =
			request.accountToken ??
			this._options.defaultAccountToken ??
			DEFAULT_ACCOUNT_TOKEN;
		if (
			(!request.credentials || request.credentials?.type === "cookies") &&
			this._options.hbaClient &&
			!this.disallowedHBAAccountTokens?.has(accountToken)
		) {
			const hbaHeaders = await this._options.hbaClient.generateBaseHeaders(
				request.url,
				request.method,
				request.credentials?.value,
				newBody,
			);

			for (const key in hbaHeaders) {
				newHeaders.set(key, hbaHeaders[key] as string);
			}
		}

		if (!newHeaders.has(ACCEPT_CONTENT_TYPE_HEADER_NAME))
			switch (request.expect?.type) {
				case "dom": {
					newHeaders.set(ACCEPT_CONTENT_TYPE_HEADER_NAME, "text/html, */*");
					break;
				}
				case "text": {
					newHeaders.set(ACCEPT_CONTENT_TYPE_HEADER_NAME, "text/plain, */*");
					break;
				}
				case "protobuf": {
					newHeaders.set(
						ACCEPT_CONTENT_TYPE_HEADER_NAME,
						"application/x-protobuf",
					);
					break;
				}
				case "json":
				case undefined: {
					newHeaders.set(
						ACCEPT_CONTENT_TYPE_HEADER_NAME,
						"application/json, text/plain, */*",
					);
				}
			}

		if (contentType) newHeaders.set(CONTENT_TYPE_HEADER_NAME, contentType);

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

		const accountToken =
			request.accountToken ?? this._options.defaultAccountToken;
		if (accountToken && this._options.accountTokenSearchParam) {
			search.set(
				this._options.accountTokenSearchParam,
				accountToken.toString(),
			);
		}

		const overridePlatformType =
			request.overridePlatformType || this._options.defaultOverridePlatformType;
		if (overridePlatformType) {
			if (this._options.overridePlatformTypeSearchParam) {
				search.set(
					this._options.overridePlatformTypeSearchParam,
					overridePlatformType,
				);
			}
		} else if (
			this._options.trackingSearchParam &&
			!request.skipTrackingSearchParam
		) {
			search.set(this._options.trackingSearchParam, "");
		}

		const formattedUrl =
			url.startsWith("/") ||
			(canParseURL(url) &&
				(!this._options.isDev || !url.startsWith("localhost:")))
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

		let cookieJar: CookieJar | undefined;
		const accountToken =
			request.accountToken ??
			this._options.defaultAccountToken ??
			DEFAULT_ACCOUNT_TOKEN;
		if (
			request.credentials?.type === "cookies" &&
			request.credentials.value === true &&
			this._options.jars
		) {
			cookieJar = this._options.jars.get(accountToken);
		}

		const headers = await this.handleRequestHeaders(
			request,
			contentType,
			newBody ?? undefined,
			cookieJar,
		);

		const requestInfo = filterObject({
			method: request.method ?? "GET",
			headers,
			cache: request.cache,
			body: newBody,
			signal: request.signal,
			redirect: request.redirect,
			integrity: request.integrity,
			keepalive: request.keepalive,
			mode: request.mode,
			priority: request.priority,
			referrer: request.referrer,
			referrerPolicy: request.referrerPolicy,
		}) as RequestInit;

		if ("window" in request) {
			requestInfo.window = null;
		}

		if (request.credentials?.type === "cookies") {
			switch (request.credentials.value) {
				case true: {
					requestInfo.credentials = "include";
					break;
				}
				case false: {
					requestInfo.credentials = "omit";
				}
			}
		}

		const response = await (request.bypassCORS && this._options.bypassCORSFetch
			? this._options.bypassCORSFetch
			: (this._options.fetch ?? fetch))(request.url, requestInfo);

		if (cookieJar && !request.skipCheckingSetCookie) {
			const url = new URL(response.url);
			const cookies = parseSetCookieHeaders(response.headers, url);

			let shouldSkip = false;
			if (this._options.onCookiesUpdated)
				shouldSkip =
					this._options.onCookiesUpdated(accountToken, cookies) === false;

			if (!shouldSkip && !request.skipAddingCookies)
				cookieJar.addCookies(cookies, url);
		}

		return await HTTPResponse.init<U, T>(
			request,
			response,
			this._options.defaultExpect,
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

		const url = this.formatRequestUrl(request);
		const isRobloxApiRequest = url.host.endsWith(this._options.domains.main);
		const isCookiesRequest =
			!request.credentials || request.credentials.type === "cookies";

		const accountToken =
			request.accountToken ??
			this._options.defaultAccountToken ??
			DEFAULT_ACCOUNT_TOKEN;
		// handle regular CSRF tokens
		if (
			isCookiesRequest &&
			isRobloxApiRequest &&
			(request.includeCsrf ??
				(request.includeCsrf === undefined && method !== "GET"))
		) {
			const csrfToken = await this.getCsrfToken(
				request.credentials?.value as boolean,
				accountToken,
			);

			if (csrfToken) {
				headers.set(CSRF_TOKEN_HEADER_NAME, csrfToken);
			}
		}

		let retries = request.retries;
		while (true) {
			const newRequest = {
				...request,
				url: url.toString(),
				ignoreExpect: true,
				headers,
			};
			const response = await this._httpRequest<void>(newRequest);

			if (
				isCookiesRequest &&
				isRobloxApiRequest &&
				response.status.code === 403 &&
				response.headers.has(CSRF_TOKEN_HEADER_NAME)
			) {
				const csrfToken = response.headers.get(
					CSRF_TOKEN_HEADER_NAME,
				) as string;

				this.setCsrfToken(
					csrfToken,
					request.credentials?.value as boolean,
					accountToken,
				);
				headers.set(CSRF_TOKEN_HEADER_NAME, csrfToken);

				continue;
			}

			const deprecationMessage = response.headers.get(
				ROBLOX_DEPRECATION_MESSAGE_HEADER_NAME,
			);
			if (this._options.onDeprecationMessage && deprecationMessage) {
				this._options.onDeprecationMessage(
					request,
					response,
					deprecationMessage,
				);
			}

			const ratelimitHeaders = this.parseRatelimitHeaders(response.headers);

			const handleChallenge =
				this._options.handleChallenge ?? request.handleChallenge;
			if (
				isCookiesRequest &&
				isRobloxApiRequest &&
				!response.status.ok &&
				handleChallenge
			) {
				const parsedChallenge = parseChallengeHeaders(response.headers);

				if (parsedChallenge) {
					const newChallenge = await handleChallenge(
						parsedChallenge,
						newRequest,
					);
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
				this._options.defaultExpect,
				ratelimitHeaders,
				this._options.camelizeObject,
			);
		}
	}

	public addAccountCookieJar(accountToken: AccountTokenType, jar: CookieJar) {
		this.jars?.set(accountToken, jar);
	}

	public updateAccountCookieJar(
		accountToken: AccountTokenType,
		cookies: Cookie[],
	) {
		const jar = this.jars?.get(accountToken);
		if (jar) {
			jar.addCookies(cookies);
		}
	}

	public deleteAccountCookieJar(accountToken: AccountTokenType) {
		this.jars?.delete(accountToken);
	}
}

export type Ratelimit = {
	_limit: string;
	remaining: number;
	reset: number;
};
