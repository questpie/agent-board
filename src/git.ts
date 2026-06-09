import { resolve } from "node:path";

export interface GitState {
	isRepo: boolean;
	branch: string | null; // null when HEAD is detached
	detached: boolean;
	head: string | null;
	dirty: boolean;
}

async function git(
	repoPath: string,
	args: string[],
): Promise<{ code: number; out: string }> {
	const proc = Bun.spawn(["git", "-C", resolve(repoPath), ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, code] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	return { code, out: out.trim() };
}

// Absolute path to the repo root containing cwd, or null when cwd is not in a
// git work tree. Lets `init --local` anchor the board at the repo root even when
// run from a subdirectory.
export async function gitRoot(cwd: string): Promise<string | null> {
	const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
	return top.code === 0 && top.out ? top.out : null;
}

export async function gitState(repoPath: string): Promise<GitState> {
	const inside = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]);
	if (inside.code !== 0 || inside.out !== "true") {
		return { isRepo: false, branch: null, detached: false, head: null, dirty: false };
	}
	const symbolic = await git(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	const head = await git(repoPath, ["rev-parse", "HEAD"]);
	const status = await git(repoPath, ["status", "--porcelain"]);
	const detached = symbolic.code !== 0;
	return {
		isRepo: true,
		branch: detached ? null : symbolic.out,
		detached,
		head: head.code === 0 ? head.out : null,
		dirty: status.out.length > 0,
	};
}
