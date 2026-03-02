import suffixesRaw from "publicsuffix-json/public_suffix_list.json" with {
	type: "json",
};
import { SET_COOKIE_HEADER_NAME } from "../constants";

export type Cookie = {
	name: string;
	value: string;
	domain: string;
	expires?: Date;
	path: string;
	secure?: boolean;
	httpOnly?: boolean;
	sameSite?: CookieSameSite;
};

export const suffixes = [...suffixesRaw.private, ...suffixesRaw.icann];

export function parseSetCookieHeaderValue(
	cookieValue: string,
	url: URL,
): Cookie | null {
	const parts = cookieValue.split(";").filter((string) => string.length !== 0);
	const nameAndValue = parts.shift()?.split("=");

	if (!nameAndValue) return null;

	const name = nameAndValue.shift();

	if (!name) return null;

	const value = decodeURIComponent(nameAndValue.join("="));

	const cookie: Cookie = {
		name,
		value,
		domain: url.hostname,
		path: url.pathname,
	};

	for (const part of parts) {
		const sides = part.split("=");
		const key = sides.shift()?.trim().toLowerCase();
		const value = sides.join("=");

		switch (key) {
			case "expires": {
				cookie.expires = new Date(value);
				break;
			}
			case "max-age": {
				cookie.expires = new Date(
					Date.now() + Number.parseInt(value, 10) * 1_000,
				);
				break;
			}
			case "domain": {
				cookie.domain = value;
				break;
			}
			case "path": {
				cookie.path = value;
				break;
			}
			case "secure": {
				cookie.secure = true;
				break;
			}
			case "httponly": {
				cookie.httpOnly = true;
				break;
			}
			case "samesite": {
				cookie.sameSite = value.toLowerCase() as CookieSameSite;
				break;
			}
		}
	}

	return cookie;
}

export function parseSetCookieHeaders(headers: Headers, url: URL): Cookie[] {
	const cookies: Cookie[] = [];

	headers.forEach((value, header) => {
		if (header.toLowerCase() === SET_COOKIE_HEADER_NAME) {
			const cookie = parseSetCookieHeaderValue(value, url);
			if (cookie) {
				cookies.push(cookie);
			}
		}
	});

	return cookies;
}

export function getTLD(domain: string): string | undefined {
	const orderedSuffxes = suffixes.sort((a, b) => {
		const aSplit = a.split(".");
		const bSplit = b.split(".");

		return aSplit.length < bSplit.length ? 1 : aSplit === bSplit ? 0 : -1;
	});

	for (const suffix of orderedSuffxes) {
		if (domain.endsWith(`.${suffix}`)) {
			return suffix;
		}
	}
}

export function transformDomain(domain: string): string {
	return domain.startsWith(".") ? domain : `.${domain}`;
}

export function canDomainManageCookieFromDomain(
	url: URL,
	domain: string,
): boolean {
	const newDomain = transformDomain(domain.replace(/(\.)/g, "$1"));
	const newRequestUrl = `.${url.hostname}`;
	const domainTLD = getTLD(domain);

	return (
		!(!domainTLD || newDomain !== `.${domainTLD}`) ||
		newRequestUrl.endsWith(newDomain)
	);
}
