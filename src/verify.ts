import { resolve } from "node:path";

export interface VerifyResult {
	cmd: string;
	exitCode: number;
	output: string;
}

// Extract shell commands from the first fenced code block under "## Verify".
// Commands live in the task body (not frontmatter) so commas, quotes, and
// pipes survive the simple YAML parser. An absent or unfenced section yields
// zero commands, leaving the done gate dormant.
export function parseVerifyCommands(body: string): string[] {
	const section = /(^|\n)##\s+Verify\b([\s\S]*?)(?=\n##\s|\n?$)/.exec(body)?.[2] ?? "";
	const fenced = /```[a-z0-9]*\n([\s\S]*?)```/i.exec(section)?.[1] ?? "";
	return fenced
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("<!--"));
}

export async function runVerify(
	repoPath: string,
	cmds: string[],
): Promise<VerifyResult[]> {
	const results: VerifyResult[] = [];
	for (const cmd of cmds) {
		const proc = Bun.spawn(["sh", "-c", cmd], {
			cwd: resolve(repoPath),
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		results.push({ cmd, exitCode, output: (stdout + stderr).slice(-4000) });
	}
	return results;
}

export function formatVerifyEvidence(
	results: VerifyResult[],
	timestamp: string,
	head: string | null,
): string {
	const allPass = results.every((result) => result.exitCode === 0);
	const lines = [
		`### verify ${timestamp}${head ? ` @ ${head.slice(0, 8)}` : ""} — ${allPass ? "pass" : "fail"}`,
		"",
		...results.map(
			(result) => `- \`${result.cmd}\` exit=${result.exitCode}`,
		),
	];
	return lines.join("\n");
}
