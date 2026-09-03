import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import { promises as fsp } from 'fs';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

// In-memory registry of recent tasks for live status polling
const tasks = new Map();

export function getTask(taskId) {
    return tasks.get(taskId) || null;
}

export function listTasks() {
    return Array.from(tasks.values()).slice(-20);
}

/**
 * Dispatches an autonomous agent task:
 * 1. Clones the repository into an isolated workspace under /tmp
 * 2. Checks out a dedicated feature/fix branch
 * 3. Runs `claude -p "<instructions>"` inside the workspace
 * 4. Checks git status and commits changes
 * 5. Pushes branch to GitHub repository
 */
export async function runAgentTask({
    type = 'feedback',
    title,
    description,
    diagnostics = null,
    userEmail = 'user',
    repoDir,
    baseBranch = 'coolify'
}) {
    const taskId = randomUUID().slice(0, 8);
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 30) || 'update';

    const branchName = `agent/${type}-${slug}-${Date.now().toString().slice(-6)}`;

    const taskRecord = {
        id: taskId,
        type,
        title,
        branch: branchName,
        status: 'queued', // queued | cloning | running_agent | committing | pushing | completed | failed
        log: [],
        startedAt: new Date().toISOString(),
        finishedAt: null,
        commitHash: null,
        error: null
    };

    tasks.set(taskId, taskRecord);

    function log(msg) {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        taskRecord.log.push(line);
        console.log(`[AgentWorker ${taskId}] ${msg}`);
    }
    // Background execution
    (async () => {
        const tempBase = process.env.AGENT_WORKSPACE_DIR || path.join(os.tmpdir(), 'dc-agent-workspaces');
        const workspaceDir = path.join(tempBase, `task-${taskId}`);

        try {
            await fsp.mkdir(tempBase, { recursive: true });
            log(`Starting agent task for: "${title}" (type: ${type})`);

            // Authenticated GitHub Remote URL
            let pushRemoteUrl = null;
            const gitHubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

            try {
                const { stdout: remoteOut } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: repoDir });
                const baseRemote = remoteOut.trim();
                if (gitHubToken && baseRemote.startsWith('https://github.com/')) {
                    const u = new URL(baseRemote);
                    u.username = 'x-access-token';
                    u.password = gitHubToken;
                    pushRemoteUrl = u.toString();
                } else {
                    pushRemoteUrl = baseRemote;
                }
            } catch (rErr) {
                log(`Notice: Could not read remote: ${rErr.message}`);
                pushRemoteUrl = 'origin';
            }

            // 1. Clone repo into workspace
            taskRecord.status = 'cloning';
            log(`Cloning repository (${baseBranch})...`);

            let cloneSuccess = false;
            try {
                await execFileAsync('git', ['clone', '--depth', '1', '--branch', baseBranch, repoDir, workspaceDir], {
                    timeout: 60000
                });
                cloneSuccess = true;
            } catch (localCloneErr) {
                log(`Local clone fallback: ${localCloneErr.message}`);
            }

            if (!cloneSuccess && pushRemoteUrl && pushRemoteUrl !== 'origin') {
                await execFileAsync('git', ['clone', '--depth', '1', '--branch', baseBranch, pushRemoteUrl, workspaceDir], {
                    timeout: 90000
                });
            }

            await execFileAsync('git', ['config', 'user.name', 'Diffusion Canvas Agent'], { cwd: workspaceDir });
            await execFileAsync('git', ['config', 'user.email', 'agent@diffusioncanvas.local'], { cwd: workspaceDir });
            await execFileAsync('git', ['checkout', '-b', branchName], { cwd: workspaceDir });
            log(`Checked out branch: ${branchName}`);
            // 2. Assemble prompt instructions
            const prompt = `You are an automated coding agent inside the Diffusion Canvas repository.
Diffusion Canvas is a web-based, node-driven visual AI canvas (Vanilla ES6 modules + Express backend).

TASK: ${type.toUpperCase()} - ${title}
REPORTED BY: ${userEmail}

REQUIREMENTS:
${description}

${diagnostics ? `DIAGNOSTICS:\n${JSON.stringify(diagnostics, null, 2)}` : ''}

GUIDELINES:
- Node definitions live in /nodes/ (e.g. ImageNode.js, DrawNode.js, FormatNode.js).
- Frontend modules live in /modules/ and script.js.
- Backend APIs live in server.js.
- Clean ES6 JavaScript, no external bundling step.
- Verify that your JavaScript files are valid syntax.

Implement the requested changes now.`;

            // 3. Run Claude Code CLI
            taskRecord.status = 'running_agent';
            log('Spawning Claude Code CLI agent in workspace...');

            await new Promise((resolve, reject) => {
                const proc = execFile('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
                    cwd: workspaceDir,
                    env: { ...process.env, CI: '1' },
                    timeout: 10 * 60 * 1000
                }, (err, stdout, stderr) => {
                    if (stdout) log(`Agent output: ${stdout.slice(-350).trim()}`);
                    if (stderr) log(`Agent stderr: ${stderr.slice(-250).trim()}`);
                    if (err) return reject(new Error(`Claude CLI execution failed: ${err.message}`));
                    resolve();
                });
                if (proc.stdin) proc.stdin.end();
            });

            // 4. Verify git changes
            const { stdout: gitStatus } = await execFileAsync('git', ['status', '--porcelain'], { cwd: workspaceDir });
            if (!gitStatus.trim()) {
                log('No file modifications were made by agent.');
                taskRecord.status = 'completed';
                taskRecord.finishedAt = new Date().toISOString();
                return;
            }

            log(`Changed files:\n${gitStatus.trim()}`);

            // 5. Commit
            taskRecord.status = 'committing';
            await execFileAsync('git', ['add', '-A'], { cwd: workspaceDir });
            const commitMsg = `${type === 'error' ? 'fix' : 'feat'}(agent): ${title}\n\nRequested by ${userEmail} via Diffusion Canvas`;
            await execFileAsync('git', ['commit', '-m', commitMsg], { cwd: workspaceDir });

            const { stdout: revOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspaceDir });
            taskRecord.commitHash = revOut.trim().slice(0, 7);
            log(`Committed: ${taskRecord.commitHash}`);

            // 6. Push to GitHub
            taskRecord.status = 'pushing';
            log(`Pushing branch ${branchName} to GitHub...`);

            const targetPushUrl = (pushRemoteUrl && pushRemoteUrl !== 'origin') ? pushRemoteUrl : 'origin';
            await execFileAsync('git', ['push', '-u', targetPushUrl, `${branchName}:${branchName}`], {
                cwd: workspaceDir,
                timeout: 60000
            });
            log(`Branch ${branchName} successfully pushed to GitHub.`);

            // Optional auto-merge to deploy branch
            if (process.env.AGENT_AUTO_MERGE === 'true' && baseBranch) {
                log(`AGENT_AUTO_MERGE active: merging into ${baseBranch}...`);
                await execFileAsync('git', ['checkout', baseBranch], { cwd: workspaceDir });
                await execFileAsync('git', ['merge', branchName, '--no-ff', '-m', `Merge branch '${branchName}' via Diffusion Canvas Agent`], { cwd: workspaceDir });
                await execFileAsync('git', ['push', targetPushUrl, baseBranch], { cwd: workspaceDir });
                log(`Direct push to ${baseBranch} completed. Live deployment triggered.`);
            }

            taskRecord.status = 'completed';
            taskRecord.finishedAt = new Date().toISOString();
            log(`Agent task finished successfully.`);

        } catch (taskErr) {
            console.error(`[AgentWorker ${taskId}] Error:`, taskErr);
            taskRecord.status = 'failed';
            taskRecord.error = taskErr.message;
            taskRecord.finishedAt = new Date().toISOString();
            log(`Error: ${taskErr.message}`);
        } finally {
            try {
                await fsp.rm(workspaceDir, { recursive: true, force: true });
                log('Workspace cleaned up.');
            } catch (cErr) {
                // ignore
            }
        }
    })();

    return taskRecord;
}

