export function canParseURL(url: string) {
	if ("canParse" in URL) {
		return URL.canParse(url);
	}
	try {
		// @ts-expect-error: sometimes it wont exist
		new URL(url);
		return true;
	} catch {
		return false;
	}
}

export type FilterObject<T extends Record<string, unknown>> = {
	[key in keyof T]: T[key] extends null | undefined ? never : T[key];
};

export function filterObject<T extends Record<string, unknown>>(obj: T): FilterObject<T> {
	const newObj = {} as FilterObject<T>;
	for (const key in obj) {
		if (obj[key] !== null && obj[key] !== undefined) {
			// @ts-expect-error: fine
			newObj[key] = obj[key];
		}
	}

	return newObj;
}