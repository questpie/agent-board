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

// Default per-command timeout. A hanging verify command must not block the
// done gate forever, so on expiry we kill the child and record a failure.
const DEFAULT_VERIFY_TIMEOUT_MS = 600_000;

function verifyTimeoutMs(): number {
	const raw = Number(process.env.AGENT_BOARD_VERIFY_TIMEOUT_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VERIFY_TIMEOUT_MS;
}

export async function runVerify(
	repoPath: string,
	cmds: string[],
): Promise<VerifyResult[]> {
	const results: VerifyResult[] = [];
	const timeoutMs = verifyTimeoutMs();
	for (const cmd of cmds) {
		const proc = Bun.spawn(["sh", "-c", cmd], {
			cwd: resolve(repoPath),
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});
		// Drain streams concurrently so a full pipe buffer cannot deadlock exit.
		const stdoutText = new Response(proc.stdout).text();
		const stderrText = new Response(proc.stderr).text();
		let timedOut = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const exitCode = await Promise.race([
			proc.exited,
			new Promise<number>((res) => {
				timer = setTimeout(() => {
					timedOut = true;
					proc.kill();
					res(124);
				}, timeoutMs);
			}),
		]);
		if (timer) clearTimeout(timer);
		const [stdout, stderr] = await Promise.all([stdoutText, stderrText]);
		const captured = (stdout + stderr).slice(-4000);
		const output = timedOut
			? `${captured}\ntimed out after ${Math.round(timeoutMs / 1000)}s`.slice(-4000)
			: captured;
		results.push({ cmd, exitCode, output });
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
	];
	for (const result of results) {
		lines.push(`- \`${result.cmd}\` exit=${result.exitCode}`);
		// Surface a tail of output for failures so evidence shows WHY it failed;
		// passing commands stay one-line to avoid bloating the record.
		if (result.exitCode !== 0) {
			const tail = result.output.slice(-800).trim();
			if (tail.length > 0) {
				lines.push("", "```", tail, "```");
			}
		}
	}
	return lines.join("\n");
}
