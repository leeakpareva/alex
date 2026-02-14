/**
 * Ralph — Self-Improvement Engine for ALEX
 *
 * Reads diary entries + user feedback, identifies failures/patterns,
 * proposes fixes, and logs results. This is the autonomous improvement loop.
 *
 * Runs daily at 9 PM via heartbeat task 'ralph-review'.
 */

import fs from 'fs/promises';
import path from 'path';
import { WORKSPACE_PATH } from './config.js';
import { writeDiaryEntry } from './daily-journal.js';

const FIXES_DIR = path.join(WORKSPACE_PATH, 'fixes');
const FEEDBACK_DIR = path.join(WORKSPACE_PATH, 'logs', 'feedback');
const DIARY_PATH = path.join(WORKSPACE_PATH, 'diary', 'progress.txt');

/**
 * Read the last N lines from the diary/progress.txt
 */
async function readRecentDiary(lines = 50) {
    try {
        const content = await fs.readFile(DIARY_PATH, 'utf8');
        const allLines = content.trim().split('\n');
        return allLines.slice(-lines).join('\n');
    } catch {
        return '';
    }
}

/**
 * Read recent feedback JSONL files (last 7 days)
 */
async function readRecentFeedback() {
    try {
        await fs.mkdir(FEEDBACK_DIR, { recursive: true });
        const files = await fs.readdir(FEEDBACK_DIR);
        const now = Date.now();
        const weekMs = 7 * 24 * 3600 * 1000;
        const feedback = [];

        for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;
            const filePath = path.join(FEEDBACK_DIR, file);
            const stat = await fs.stat(filePath).catch(() => null);
            if (!stat || now - stat.mtimeMs > weekMs) continue;

            const content = await fs.readFile(filePath, 'utf8');
            for (const line of content.split('\n')) {
                if (!line.trim()) continue;
                try {
                    feedback.push(JSON.parse(line));
                } catch { continue; }
            }
        }
        return feedback;
    } catch {
        return [];
    }
}

/**
 * Run Ralph's self-improvement review.
 * Analyzes diary + feedback, identifies issues, proposes fixes.
 *
 * @param {object} deps - { callAnthropicQueued, config }
 */
export async function runRalphReview(deps) {
    const { callAnthropicQueued, config, db = null } = deps;
    console.log('[RALPH] Starting self-improvement review...');

    await fs.mkdir(FIXES_DIR, { recursive: true });

    // Gather inputs
    const diaryLines = config?._yaml?.ralph?.diary_lines || 50;
    const diary = await readRecentDiary(diaryLines);
    const feedback = await readRecentFeedback();

    if (!diary && feedback.length === 0) {
        console.log('[RALPH] No diary or feedback to analyze — skipping');
        return 'No data to analyze.';
    }

    // Build analysis prompt
    const feedbackSummary = feedback.length > 0
        ? `\n\nUser feedback (last 7 days, ${feedback.length} entries):\n${feedback.map(f =>
            `- ${f.rating === 'good' ? 'POSITIVE' : 'NEGATIVE'} [${f.task_name || 'unknown'}] ${f.comment || '(no comment)'}`
        ).join('\n')}`
        : '\n\nNo user feedback available yet.';

    const model = config?._yaml?.ralph?.model || 'claude-3-5-haiku-20241022';
    const maxTokens = config?._yaml?.ralph?.max_tokens || 4096;
    const maxFixes = config?._yaml?.ralph?.max_fixes_per_run || 3;

    const prompt = `You are Ralph, the self-improvement engine for an AI agent called ALEX. ALEX runs on a Raspberry Pi and handles tasks like morning briefings, research, emails, and stock alerts via scheduled heartbeat tasks.

Your job: Read ALEX's recent diary entries and user feedback. Identify failures, patterns, or areas for improvement. Propose concrete fixes.

Recent diary (last ${diaryLines} lines):
${diary || '(empty)'}
${feedbackSummary}

Instructions:
1. Look for FAILED entries, errors, repeated issues, or patterns of low-quality output
2. Look for user feedback trends (what does the user find valuable vs useless?)
3. Propose up to ${maxFixes} concrete, actionable fixes
4. For each fix, specify: what the issue is, what to change, and expected impact

Format your response as:

## Ralph Review — ${new Date().toISOString().split('T')[0]}

### Issues Found
- [list issues with evidence from diary/feedback]

### Proposed Fixes
1. **[Fix title]** — [What to change and why]
2. ...

### Overall Health
[1-2 sentence assessment of ALEX's recent performance]

If everything looks healthy and no issues found, say so clearly.`;

    try {
        const response = await callAnthropicQueued({
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
        }, 0, { source: 'ralph-review' });

        const reviewText = response?.content?.[0]?.text || 'Ralph: No analysis produced.';

        // Best-effort persistence (optional)
        if (db && typeof db.insertRalphReview === 'function') {
            try {
                const issueMatch = reviewText.match(/### Issues Found\n([\s\S]*?)(?=###|$)/);
                const fixMatch = reviewText.match(/### Proposed Fixes\n([\s\S]*?)(?=###|$)/);
                const healthMatch = reviewText.match(/### Overall Health\n([\s\S]*?)$/);

                const issues = [];
                const fixes = [];
                if (issueMatch) {
                    for (const line of issueMatch[1].split('\n')) {
                        const t = line.replace(/^[-*]\s*/, '').trim();
                        if (t) issues.push(t);
                    }
                }
                if (fixMatch) {
                    for (const line of fixMatch[1].split('\n')) {
                        const t = line.replace(/^\d+\.\s*/, '').trim();
                        if (t) fixes.push(t);
                    }
                }
                const health = healthMatch ? healthMatch[1].trim() : null;

                await db.insertRalphReview({
                    model,
                    issues: issues.length ? issues : null,
                    fixes: fixes.length ? fixes : null,
                    health,
                    review: reviewText,
                });
            } catch {
                // Never block Ralph on persistence failures.
            }
        }

        // Save fix proposal to disk
        const date = new Date().toISOString().split('T')[0];
        const time = new Date().toISOString().split('T')[1].substring(0, 5).replace(':', '');
        const fixPath = path.join(FIXES_DIR, `${date}-${time}-review.md`);
        await fs.writeFile(fixPath, reviewText);
        await fs.chmod(fixPath, 0o600);
        console.log(`[RALPH] Review saved: ${fixPath}`);

        // Log to diary
        const shortSummary = reviewText.substring(0, 200).replace(/\n/g, ' ');
        await writeDiaryEntry(`Ralph review: ${shortSummary}`).catch(() => {});

        return reviewText;
    } catch (err) {
        console.error('[RALPH] Review failed:', err.message);
        await writeDiaryEntry(`Ralph review FAILED: ${err.message}`).catch(() => {});
        return `Ralph review failed: ${err.message}`;
    }
}
