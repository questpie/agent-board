export interface FrontmatterDocument<T extends Record<string, unknown>> {
	meta: T;
	body: string;
}

export function parseFrontmatter<T extends Record<string, unknown>>(
	content: string,
): FrontmatterDocument<T> {
	if (!content.startsWith("---\n")) {
		throw new Error("Missing frontmatter");
	}
	const end = content.indexOf("\n---", 4);
	if (end === -1) throw new Error("Unclosed frontmatter");

	const raw = content.slice(4, end);
	const body = content.slice(end + 4).replace(/^\n/, "");
	return {
		meta: parseSimpleYaml(raw) as T,
		body,
	};
}

export function stringifyFrontmatter<T extends Record<string, unknown>>(
	meta: T,
	body: string,
	order: string[],
): string {
	const keys = [
		...order.filter((key) => key in meta),
		...Object.keys(meta).filter((key) => !order.includes(key)).sort(),
	];
	const lines = keys.map((key) => `${key}: ${formatValue(meta[key])}`);
	return `---\n${lines.join("\n")}\n---\n\n${body.trimStart()}`;
}

function parseSimpleYaml(input: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = input.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (!line.trim()) continue;
		const match = /^([A-Za-z0-9_]+):(?:\s*(.*))?$/.exec(line);
		if (!match) throw new Error(`Unsupported frontmatter line: ${line}`);

		const key = match[1]!;
		const raw = match[2] ?? "";
		if (raw === "") {
			const items: string[] = [];
			while (lines[i + 1]?.startsWith("  - ")) {
				i++;
				items.push(unquote(lines[i]!.slice(4).trim()));
			}
			result[key] = items;
			continue;
		}
		result[key] = parseScalar(raw.trim());
	}

	return result;
}

function parseScalar(raw: string): unknown {
	if (raw === "[]") return [];
	if (raw.startsWith("[") && raw.endsWith("]")) {
		const inner = raw.slice(1, -1).trim();
		if (!inner) return [];
		return inner.split(",").map((item) => unquote(item.trim()));
	}
	return unquote(raw);
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function formatValue(value: unknown): string {
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		return `[${value.map((item) => JSON.stringify(String(item))).join(", ")}]`;
	}
	return JSON.stringify(String(value ?? ""));
}
