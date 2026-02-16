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
const HISTORY_PATH = path.join(WORKSPACE_PATH, 'fixes', 'ralph-history.json');
const MAX_HISTORY = 30;

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

// ============================================================================
// History management
// ============================================================================

async function loadHistory() {
    try {
        const raw = await fs.readFile(HISTORY_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

async function saveHistory(history) {
    await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
    const trimmed = history.slice(-MAX_HISTORY);
    await fs.writeFile(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
    await fs.chmod(HISTORY_PATH, 0o600);
}

function computeStats(history) {
    if (!history.length) return {};
    let totalIssues = 0, totalFixes = 0, totalScore = 0, scored = 0;
    for (const r of history) {
        totalIssues += (r.issues || []).length;
        totalFixes += (r.fixes || []).length;
        if (typeof r.health_score === 'number') { totalScore += r.health_score; scored++; }
    }
    return {
        total_reviews: history.length,
        total_issues_found: totalIssues,
        total_fixes_proposed: totalFixes,
        avg_issues_per_review: +(totalIssues / history.length).toFixed(1),
        avg_health_score: scored ? +(totalScore / scored).toFixed(1) : null,
    };
}

/**
 * Export for gateway to call on load
 */
export async function getRalphHistory() {
    const history = await loadHistory();
    return { history: history.slice(-7), stats: computeStats(history) };
}

/**
 * One-time migration: parse existing review .md files into history format
 */
export async function migrateExistingReviews() {
    try {
        const existing = await loadHistory();
        if (existing.length > 0) return; // already migrated

        await fs.mkdir(FIXES_DIR, { recursive: true });
        const files = (await fs.readdir(FIXES_DIR)).filter(f => f.endsWith('-review.md')).sort();
        if (!files.length) return;

        const history = [];
        for (const file of files.slice(-30)) {
            const content = await fs.readFile(path.join(FIXES_DIR, file), 'utf8');
            const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
            const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];

            const issues = [];
            const fixes = [];
            let health = '';

            const issueMatch = content.match(/### Issues Found\n([\s\S]*?)(?=###|$)/);
            if (issueMatch) {
                for (const line of issueMatch[1].split('\n')) {
                    const t = line.replace(/^[-*]\s*/, '').trim();
                    if (t) issues.push({ text: t, category: 'quality' });
                }
            }
            const fixMatch = content.match(/### Proposed Fixes\n([\s\S]*?)(?=###|$)/);
            if (fixMatch) {
                for (const line of fixMatch[1].split('\n')) {
                    const t = line.replace(/^\d+\.\s*/, '').trim();
                    if (t) fixes.push({ text: t, status: 'proposed' });
                }
            }
            const healthMatch = content.match(/### Overall Health\n([\s\S]*?)$/);
            if (healthMatch) health = healthMatch[1].trim();

            history.push({
                id: file.replace('.md', ''),
                date,
                status: 'completed',
                issues,
                fixes,
                health,
                health_score: null,
                duration_ms: null,
                diary_lines_analyzed: null,
                feedback_entries_analyzed: null,
            });
        }

        if (history.length) {
            await saveHistory(history);
            console.log(`[RALPH] Migrated ${history.length} existing reviews to history`);
        }
    } catch (err) {
        console.error('[RALPH] Migration failed:', err.message);
    }
}

// ============================================================================
// Parse structured JSON from <ralph-json> tags
// ============================================================================

function parseStructuredJson(text) {
    const match = text.match(/<ralph-json>([\s\S]*?)<\/ralph-json>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].trim());
    } catch {
        return null;
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
    const startTime = Date.now();

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
5. Assign each issue a category: reliability, performance, quality, cost, logging, or security
6. Give a health score from 1-10 (1=critical, 10=excellent)

Format your response as:

## Ralph Review — ${new Date().toISOString().split('T')[0]}

### Issues Found
- [list issues with evidence from diary/feedback]

### Proposed Fixes
1. **[Fix title]** — [What to change and why]
2. ...

### Overall Health
[1-2 sentence assessment of ALEX's recent performance]

After the markdown, output structured data in this exact format:
<ralph-json>
{
  "issues": [{"text": "issue description", "category": "reliability|performance|quality|cost|logging|security"}],
  "fixes": [{"text": "fix description", "status": "proposed"}],
  "health_score": 7
}
</ralph-json>

If everything looks healthy and no issues found, say so clearly.`;

    try {
        const response = await callAnthropicQueued({
            model,
            max_tokens: maxTokens,
            messages: [{ role: 'user', content: prompt }]
        }, 0, { source: 'ralph-review' });

        const reviewText = response?.content?.[0]?.text || 'Ralph: No analysis produced.';
        const durationMs = Date.now() - startTime;

        // Parse structured JSON if present
        const structured = parseStructuredJson(reviewText);

        // Fall back to markdown parsing
        const issues = [];
        const fixes = [];
        let health = '';
        let healthScore = structured?.health_score ?? null;

        if (structured && structured.issues) {
            for (const i of structured.issues) {
                issues.push({ text: i.text, category: i.category || 'quality' });
            }
        } else {
            const issueMatch = reviewText.match(/### Issues Found\n([\s\S]*?)(?=###|$)/);
            if (issueMatch) {
                for (const line of issueMatch[1].split('\n')) {
                    const t = line.replace(/^[-*]\s*/, '').trim();
                    if (t) issues.push({ text: t, category: 'quality' });
                }
            }
        }

        if (structured && structured.fixes) {
            for (const f of structured.fixes) {
                fixes.push({ text: f.text, status: f.status || 'proposed' });
            }
        } else {
            const fixMatch = reviewText.match(/### Proposed Fixes\n([\s\S]*?)(?=###|$)/);
            if (fixMatch) {
                for (const line of fixMatch[1].split('\n')) {
                    const t = line.replace(/^\d+\.\s*/, '').trim();
                    if (t) fixes.push({ text: t, status: 'proposed' });
                }
            }
        }

        const healthMatch = reviewText.match(/### Overall Health\n([\s\S]*?)(?=<ralph-json>|$)/);
        if (healthMatch) health = healthMatch[1].trim();

        // Best-effort DB persistence
        if (db && typeof db.insertRalphReview === 'function') {
            try {
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
        // Strip <ralph-json> block from saved markdown
        const cleanReview = reviewText.replace(/<ralph-json>[\s\S]*?<\/ralph-json>/, '').trim();
        await fs.writeFile(fixPath, cleanReview);
        await fs.chmod(fixPath, 0o600);
        console.log(`[RALPH] Review saved: ${fixPath}`);

        // Save to history
        const historyEntry = {
            id: `${date}-${time}`,
            date,
            status: 'completed',
            issues,
            fixes,
            health,
            health_score: healthScore,
            duration_ms: durationMs,
            diary_lines_analyzed: diaryLines,
            feedback_entries_analyzed: feedback.length,
        };

        const history = await loadHistory();
        history.push(historyEntry);
        await saveHistory(history);
        console.log(`[RALPH] History updated (${history.length} entries)`);

        // Log to diary
        const shortSummary = cleanReview.substring(0, 200).replace(/\n/g, ' ');
        await writeDiaryEntry(`Ralph review: ${shortSummary}`).catch(() => {});

        return reviewText;
    } catch (err) {
        console.error('[RALPH] Review failed:', err.message);
        await writeDiaryEntry(`Ralph review FAILED: ${err.message}`).catch(() => {});
        return `Ralph review failed: ${err.message}`;
    }
}
