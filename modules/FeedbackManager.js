import { apiFetch as fetch } from './ApiSession.js';

// FeedbackManager: handles feedback, bug reporting, and node requests.
export class FeedbackManager {
    constructor({ uiManager, nodeManager, getBoardInfo = () => ({}) }) {
        this.uiManager = uiManager;
        this.nodeManager = nodeManager;
        this.getBoardInfo = getBoardInfo;

        this.modal = document.getElementById('feedbackModal');
        this.form = document.getElementById('feedbackForm');
        this.typeTabs = document.getElementById('feedbackTypeTabs');
        this.titleInput = document.getElementById('feedbackTitle');
        this.descInput = document.getElementById('feedbackDescription');
        this.runAgentCheckbox = document.getElementById('feedbackRunAgent');
        this.diagnosticsCheckbox = document.getElementById('feedbackAttachDiagnostics');
        this.statusEl = document.getElementById('feedbackStatus');
        this.submitBtn = document.getElementById('feedbackSubmitBtn');
        this.cancelBtn = document.getElementById('feedbackCancelBtn');
        this.closeBtn = document.getElementById('feedbackModalClose');

        this.feedbackBtn = document.getElementById('feedbackBtn');
        this.userMenuFeedbackBtn = document.getElementById('userMenuFeedbackBtn');
        this.activeType = 'error';
    }

    init() {
        this.setupButtons();
        this.setupTabs();
        this.setupForm();
    }

    setupButtons() {
        if (this.feedbackBtn) {
            this.feedbackBtn.addEventListener('click', () => this.open());
        }
        if (this.userMenuFeedbackBtn) {
            this.userMenuFeedbackBtn.addEventListener('click', () => {
                const userDropdown = document.getElementById('userDropdown');
                if (userDropdown) userDropdown.classList.remove('active');
                this.open();
            });
        }
        if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
        if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.close());
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) this.close();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal?.classList.contains('active')) {
                this.close();
            }
        });
    }

    setupTabs() {
        if (!this.typeTabs) return;
        this.typeTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.feedback-type-btn');
            if (!btn) return;
            this.typeTabs.querySelectorAll('.feedback-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.activeType = btn.dataset.type || 'error';
            this.updatePlaceholders();
        });
    }

    updatePlaceholders() {
        if (!this.titleInput || !this.descInput) return;
        if (this.activeType === 'error') {
            this.titleInput.placeholder = 'e.g. Generation fails when outpainting transparent png...';
            this.descInput.placeholder = 'Steps to reproduce:\n1. Add outpaint node\n2. Connect image\n3. Click generate\n\nExpected behavior vs actual error:';
        } else if (this.activeType === 'node_request') {
            this.titleInput.placeholder = 'e.g. Add depth-estimation node (MiDaS / ZoeDepth)...';
            this.descInput.placeholder = 'What should this node do?\n- Inputs: (e.g. image)\n- Controls: (e.g. model)\n- Outputs: (e.g. depth map)\n- Expected model or library:';
        } else {
            this.titleInput.placeholder = 'e.g. Keyboard shortcut to duplicate nodes with Alt-drag...';
            this.descInput.placeholder = 'Describe your idea or feedback and how it would improve your workflow:';
        }
    }

    open(prefill = {}) {
        if (!this.modal) return;
        if (prefill.type) {
            this.activeType = prefill.type;
            const btn = this.typeTabs?.querySelector(`[data-type="${prefill.type}"]`);
            if (btn) {
                this.typeTabs.querySelectorAll('.feedback-type-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
        }
        this.updatePlaceholders();
        if (prefill.title) this.titleInput.value = prefill.title;
        if (prefill.description) this.descInput.value = prefill.description;

        this.clearStatus();
        this.submitBtn.disabled = false;
        this.modal.classList.add('active');
        requestAnimationFrame(() => {
            if (this.titleInput.value) {
                this.descInput.focus();
            } else {
                this.titleInput.focus();
            }
        });
    }

    close() {
        if (!this.modal) return;
        this.modal.classList.remove('active');
        this.clearStatus();
    }

    clearStatus() {
        if (!this.statusEl) return;
        this.statusEl.className = 'feedback-status';
        this.statusEl.innerHTML = '';
        this.statusEl.style.display = 'none';
    }

    showStatus(msg, type = 'info') {
        if (!this.statusEl) return;
        this.statusEl.className = `feedback-status active ${type}`;
        this.statusEl.innerHTML = msg;
        this.statusEl.style.display = 'block';
    }

    gatherDiagnostics() {
        const board = this.getBoardInfo() || {};
        const nodes = this.nodeManager?.nodes || [];
        const nodeTypeCounts = {};
        for (const n of nodes) {
            nodeTypeCounts[n.type] = (nodeTypeCounts[n.type] || 0) + 1;
        }

        return {
            url: window.location.href,
            boardName: board.name || 'Untitled',
            boardId: board.id || null,
            nodeCount: nodes.length,
            nodeTypes: nodeTypeCounts,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString()
        };
    }

    setupForm() {
        if (!this.form) return;
        this.form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const title = (this.titleInput.value || '').trim();
            const description = (this.descInput.value || '').trim();
            if (!title || !description) return;

            const runAgent = !!this.runAgentCheckbox?.checked;
            const attachDiag = !!this.diagnosticsCheckbox?.checked;
            const diagnostics = attachDiag ? this.gatherDiagnostics() : null;

            this.submitBtn.disabled = true;
            this.showStatus('<span class="loading"></span> Initiating agent workspace & task...', 'info');

            try {
                const res = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        type: this.activeType,
                        title,
                        description,
                        runAgent,
                        diagnostics
                    })
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data.error || `Server responded with ${res.status}`);
                }

                if (data.taskId) {
                    this.pollTaskStatus(data.taskId, data.agentBranch);
                } else {
                    this.showStatus('<strong>Request submitted!</strong>', 'success');
                    this.form.reset();
                    setTimeout(() => this.close(), 2500);
                }

            } catch (err) {
                console.error('Feedback submit error:', err);
                this.showStatus(`Failed: ${err.message}`, 'error');
                this.submitBtn.disabled = false;
            }
        });
    }

    pollTaskStatus(taskId, branchName) {
        const checkInterval = 2500;
        const statusMap = {
            queued: 'Queued...',
            cloning: 'Cloning repository workspace...',
            running_agent: 'Claude Code Agent is coding & validating...',
            committing: 'Committing changes...',
            pushing: 'Pushing branch to GitHub...',
            completed: 'Agent finished & pushed successfully!',
            failed: 'Agent encountered an error.'
        };

        const timer = setInterval(async () => {
            try {
                const res = await fetch(`/api/agent/status/${taskId}`, { credentials: 'include' });
                if (!res.ok) return;
                const task = await res.json();

                const label = statusMap[task.status] || task.status;
                let html = `<strong>${label}</strong><br>`;
                html += `<span style="font-size:11px;opacity:0.85;">Branch: <code>${branchName || task.branch}</code></span>`;

                if (task.status === 'completed') {
                    clearInterval(timer);
                    html = `<strong>Changes implemented & pushed to GitHub!</strong><br>` +
                           `<span style="font-size:11px;">Branch: <code>${task.branch}</code> (Commit: ${task.commitHash || 'done'})</span><br>` +
                           `<span style="font-size:11px;color:var(--text-muted);">Coolify will pick up the branch.</span>`;
                    this.showStatus(html, 'success');
                    this.submitBtn.disabled = false;
                    this.form.reset();
                    if (this.uiManager?.updateStatus) {
                        this.uiManager.updateStatus(`Agent pushed branch ${task.branch}`, '#27ae60');
                    }
                    setTimeout(() => this.close(), 6000);
                } else if (task.status === 'failed') {
                    clearInterval(timer);
                    html = `<strong>Agent failed:</strong> ${task.error || 'Unknown error'}`;
                    this.showStatus(html, 'error');
                    this.submitBtn.disabled = false;
                } else {
                    this.showStatus(`<span class="loading"></span> ${html}`, 'info');
                }
            } catch (pollErr) {
                // Keep polling
            }
        }, checkInterval);
    }
}
