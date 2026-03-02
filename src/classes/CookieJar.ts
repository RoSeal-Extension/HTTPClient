import {
	type Cookie,
	canDomainManageCookieFromDomain,
	parseSetCookieHeaders,
	transformDomain,
} from "../utils/cookies.ts";

export type DomainSettingCookie = {
	name: string;
	allowed: boolean;
};

export type DomainSetting = {
	domain: string;
	allowed: boolean;
	cookies?: DomainSettingCookie[];
};

export class CookieJar extends Set<Cookie> {
	private readonly _domainSettings: DomainSetting[] = [];
	private readonly _allowAllDomains: boolean = true;

	public get domainSettings() {
		return this._domainSettings;
	}

	public get allowAllDomains() {
		return this._allowAllDomains;
	}

	public getCookiesFromURL(url: URL): Cookie[] {
		// use this to filter out cookies
		const cookies: Record<string, Cookie> = {};

		for (const [cookie] of this.entries()) {
			if (!cookie.expires || cookie.expires > new Date()) {
				if (
					(!cookie.secure || url.protocol === "https:") &&
					canDomainManageCookieFromDomain(url, cookie.domain) &&
					url.pathname.startsWith(cookie.path)
				) {
					const originalCookie = cookies[cookie.name];

					if (originalCookie) {
						// if longer, set it
						if (
							originalCookie.domain.split(".").length <
								cookie.domain.split(".").length ||
							originalCookie.path.split("/").length <
								cookie.path.split("/").length
						) {
							cookies[cookie.name] = cookie;
						}
					} else cookies[cookie.name] = cookie;
				}
			} else {
				// cookie expired, delete it!
				this.delete(cookie);
			}
		}

		return Object.values(cookies);
	}

	public getCookieStringFromURL(url: URL, decode = false): string {
		const cookies = this.getCookiesFromURL(url);
		let cookieString = "";

		for (const cookie of cookies) {
			cookieString = `${cookieString !== "" ? `${cookieString}; ` : ""}${
				decode ? encodeURIComponent(cookie.name) : cookie.name
			}=${decode ? encodeURIComponent(cookie.value) : cookie.value}`;
		}

		return cookieString;
	}

	public isCookieAllowed(cookie: Cookie): boolean {
		let domain: DomainSetting | undefined;
		for (const domainSetting of this.domainSettings) {
			if (
				transformDomain(cookie.domain).endsWith(
					transformDomain(domainSetting.domain),
				)
			) {
				if (
					!domain ||
					domainSetting.domain.split(".").length >
						domain.domain.split(".").length
				) {
					domain = domainSetting;
				}
			}
		}

		if (domain?.cookies) {
			for (const domainCookie of domain.cookies) {
				if (domainCookie.name === cookie.name) {
					return domainCookie.allowed;
				}
			}
			return false;
		}

		return domain?.allowed ?? this._allowAllDomains;
	}

	public addCookies(cookies: Cookie[], url?: URL): void {
		for (const cookie of cookies) {
			if (
				this.isCookieAllowed(cookie) &&
				(!url ||
					canDomainManageCookieFromDomain(url, transformDomain(cookie.domain)))
			) {
				// if cookie exists, let's delete it so we override it
				this.deleteCookie(cookie.name, cookie.domain);
				if (cookie.value) this.add(cookie);
			}
		}
	}

	public addCookiesFromHeaders(headers: Headers, url: URL) {
		const cookies = this.parseSetCookieHeaders(headers, url);

		this.addCookies(cookies, url);
	}

	public parseSetCookieHeaders(headers: Headers, url: URL) {
		return parseSetCookieHeaders(headers, url);
	}

	public deleteCookie(name: string, domain: string): void {
		this.forEach((cookie) => {
			if (cookie.name === name && cookie.domain === domain) {
				this.delete(cookie);
			}
		});
	}

	constructor(domainSettings?: DomainSetting[], allowAllDomains = true) {
		super();
		if (domainSettings) this._domainSettings = domainSettings;
		if (allowAllDomains !== true) this._allowAllDomains = false;
	}
}

export type { Cookie };
