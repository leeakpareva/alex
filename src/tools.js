/**
 * Tool definitions and execution
 */

import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import nodemailer from 'nodemailer';
import { WORKSPACE_PATH, ALLOWED_WRITE_PATHS, ALLOWED_ATTACHMENT_PATHS, isPathAllowed } from './config.js';
import { calculateDecay } from './memory.js';

const execAsync = promisify(exec);

// ============================================================================
// RAG SYSTEM
// ============================================================================

let ragAvailable = false;
let ragIndexing = false; // mutex for re-indexing

export async function checkRAG() {
    try {
        await execAsync('python3 -c "import chromadb"');
        ragAvailable = true;
        console.log('[RAG] ChromaDB available');
    } catch {
        ragAvailable = false;
        console.log('[RAG] ChromaDB not available, using fallback');
    }
}

export async function indexRAG() {
    if (!ragAvailable || ragIndexing) return;
    ragIndexing = true;
    try {
        const __toolsDir = path.dirname(new URL(import.meta.url).pathname);
        const scriptPath = path.join(__toolsDir, '..', 'scripts', 'rag_manager.py');
        const { stdout } = await new Promise((resolve, reject) => {
            execFile('python3', [scriptPath, 'index'], { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve({ stdout, stderr });
            });
        });
        console.log('[RAG] Indexed:', stdout.trim());
    } catch (err) {
        console.error('[RAG] Index error:', err.message);
    } finally {
        ragIndexing = false;
    }
}

export function reindexRAG() {
    if (!ragAvailable) return;
    indexRAG().catch(err => console.error('[RAG] Re-index error:', err.message));
}

export async function queryRAG(text) {
    if (!ragAvailable || ragIndexing) return null;

    // Attempt ChromaDB query with 2 retries
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const __toolsDir = path.dirname(new URL(import.meta.url).pathname);
            const scriptPath = path.join(__toolsDir, '..', 'scripts', 'rag_manager.py');
            const { stdout } = await new Promise((resolve, reject) => {
                execFile('python3', [scriptPath, 'query', text], { timeout: 10000 }, (err, stdout, stderr) => {
                    if (err) reject(err);
                    else resolve({ stdout, stderr });
                });
            });
            const result = JSON.parse(stdout.trim());
            if (result.results && result.results.length > 0) {
                return result.results.map(r => r.text).join('\n\n---\n\n');
            }
            break; // Success but no results — don't retry
        } catch (err) {
            console.error(`[RAG] Query error (attempt ${attempt + 1}/2):`, err.message);
            if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Fallback: keyword search on KNOWLEDGE.md with relevance decay
    try {
        const knowledgePath = path.join(WORKSPACE_PATH, 'KNOWLEDGE.md');
        const knowledge = await fs.readFile(knowledgePath, 'utf-8');
        const queryWords = text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const sections = knowledge.split(/\n## /).filter(s => s.trim());
        const scored = sections.map(s => {
            const lower = s.toLowerCase();
            // Calculate keyword match score
            const keywordScore = queryWords.reduce((sum, w) => sum + (lower.includes(w) ? 1 : 0), 0);
            // Extract date from section header (format: [YYYY-MM-DD])
            const dateMatch = s.match(/\[(\d{4}-\d{2}-\d{2})\]/);
            const decay = dateMatch ? calculateDecay(dateMatch[1]) : 0.5;
            // Final score: keyword relevance * temporal decay
            return { text: s.substring(0, 500), score: keywordScore * decay, rawScore: keywordScore };
        }).filter(s => s.rawScore > 0).sort((a, b) => b.score - a.score).slice(0, 3);
        if (scored.length > 0) {
            return scored.map(s => s.text).join('\n\n---\n\n');
        }
    } catch {}

    return null;
}

export function isRAGAvailable() {
    return ragAvailable;
}

// ============================================================================
// WEB LOOKUP (via Node https)
// ============================================================================

async function webLookup(query) {
    try {
        const { default: https } = await import('https');
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const html = await new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'ALEX/1.0' } }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
                res.on('error', reject);
            }).on('error', reject);
        });
        // Extract text snippets from result divs
        const snippets = [];
        const regex = /<a class="result__snippet"[^>]*>(.*?)<\/a>/gi;
        let match;
        while ((match = regex.exec(html)) !== null && snippets.length < 5) {
            snippets.push(match[1].replace(/<\/?b>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'"));
        }
        if (snippets.length > 0) {
            return { success: true, results: snippets };
        }
        return { success: true, results: [], note: 'No results found. Try a different query.' };
    } catch (err) {
        return { success: false, error: `Web lookup failed: ${err.message}` };
    }
}

// ============================================================================
// DASHBOARD HELPER — delegates to gateway's postDashboard via setter
// ============================================================================

let dashPostFn = () => {};
export function setToolsDashPost(fn) { dashPostFn = fn; }

function postDashboard(payload) {
    dashPostFn(payload.action, payload);
    return { success: true, message: `Dashboard updated (${payload.action})` };
}

// ============================================================================
// ALPHA VANTAGE HELPER
// ============================================================================

async function alphaVantageQuery(params, apiKey) {
    const url = new URL('https://www.alphavantage.co/query');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('apikey', apiKey);
    const res = await fetch(url.toString());
    const data = await res.json();
    if (data['Error Message']) throw new Error(data['Error Message']);
    if (data['Note']) throw new Error('Alpha Vantage rate limit. Try again in 60s.');
    return data;
}

// ============================================================================
// APIFY HELPER
// ============================================================================

async function apifyRunActor(actorId, input, apiKey, timeout = 120000) {
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            const errorText = await res.text();
            if (res.status === 402) throw new Error('Apify credits exhausted.');
            throw new Error(`Apify API error (${res.status}): ${errorText.substring(0, 200)}`);
        }
        const data = await res.json();

        // Track Apify API call on dashboard
        dashPostFn('update_apify', {
            actor: actorId,
            results: Array.isArray(data) ? data.length : 0,
        });

        return data;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') throw new Error(`Apify request timed out after ${timeout/1000}s`);
        throw err;
    }
}

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export const TOOLS = [
    {
        name: "bash",
        description: "Execute bash commands on the Raspberry Pi. Use for system operations, file management, running scripts, installing packages, etc. You have full sudo access.",
        input_schema: {
            type: "object",
            properties: {
                command: { type: "string", description: "The bash command to execute" },
                working_directory: { type: "string", description: "Optional working directory for the command" },
                timeout: { type: "number", description: "Timeout in milliseconds (default: 300000)" }
            },
            required: ["command"]
        }
    },
    {
        name: "read_file",
        description: "Read the contents of ANY file on this Raspberry Pi. No restrictions — can read any path. Use this first when asked to show, display, or read any file. Faster than bash cat.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file (e.g. /home/head/clawd/README.md)" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file anywhere under /home/head (creates directories if needed). Use for creating scripts, configs, reports, or any file.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file (e.g. /home/head/clawd/notes.md)" },
                content: { type: "string", description: "Content to write" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "list_directory",
        description: "List contents of ANY directory on this Pi. No restrictions. Use to browse the filesystem quickly.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the directory (e.g. /home/head/clawd)" }
            },
            required: ["path"]
        }
    },
    {
        name: "grep",
        description: "Search file contents using regex patterns. Searches recursively through directories. Use to find code, text, configs, secrets, errors, or any content across files. Much faster than bash grep.",
        input_schema: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Regex pattern to search for (e.g. 'api_key', 'function\\s+\\w+', 'error|fail')" },
                path: { type: "string", description: "File or directory to search in (e.g. /home/head/navada-1/src)" },
                include: { type: "string", description: "File glob filter (e.g. '*.js', '*.py', '*.md')" },
                max_results: { type: "number", description: "Max matching lines to return (default: 50)" }
            },
            required: ["pattern", "path"]
        }
    },
    {
        name: "glob",
        description: "Find files by name pattern. Use to locate files across the filesystem. Supports ** for recursive matching. Much faster than bash find.",
        input_schema: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Glob pattern (e.g. '**/*.js', 'src/**/*.py', '**/README*', '**/*.json')" },
                path: { type: "string", description: "Base directory to search from (e.g. /home/head)" }
            },
            required: ["pattern", "path"]
        }
    },
    {
        name: "edit_file",
        description: "Make precise edits to a file by replacing exact text. Use instead of write_file when you only need to change part of a file. Safer than rewriting the whole file.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file" },
                old_text: { type: "string", description: "Exact text to find and replace (must match exactly)" },
                new_text: { type: "string", description: "Replacement text" }
            },
            required: ["path", "old_text", "new_text"]
        }
    },
    {
        name: "web_lookup",
        description: "Search the web for current information using DuckDuckGo. Use for research, news, market data, startup information, etc.",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" }
            },
            required: ["query"]
        }
    },
    {
        name: "memory_save",
        description: "Save important information to persistent memory. Use to remember user preferences, learned facts, project context, etc.",
        input_schema: {
            type: "object",
            properties: {
                category: { type: "string", description: "Category: 'user', 'projects', 'research', 'tasks', 'knowledge'" },
                content: { type: "string", description: "Information to remember" }
            },
            required: ["category", "content"]
        }
    },
    {
        name: "memory_recall",
        description: "Recall information from persistent memory",
        input_schema: {
            type: "object",
            properties: {
                category: { type: "string", description: "Category to recall from" }
            },
            required: ["category"]
        }
    },
    {
        name: "send_email",
        description: "Compose and send a professional email. ALWAYS write the body in well-structured HTML with proper tags (<h2>, <p>, <ul>, <li>, <br>, <strong>). Include spacing between sections. Auto-CCs configured address. Supports attachments. Use the 'template' parameter to apply a polished email template — the body content will be injected into the template's {{CONTENT}} placeholder.",
        input_schema: {
            type: "object",
            properties: {
                to: { type: "string", description: "Recipient email address" },
                subject: { type: "string", description: "Email subject" },
                body: { type: "string", description: "Email body in HTML format. Use <h2> for headings, <p> for paragraphs, <ul>/<li> for lists, <strong> for emphasis. Must be properly structured and professional." },
                template: { type: "string", description: "Optional email template to use. The body is injected into the template's {{CONTENT}} area.", enum: ["daily-summary", "research-report", "alert"] },
                attachment_path: { type: "string", description: "Optional absolute path to a file to attach (must be within workspace)" },
                attachment_filename: { type: "string", description: "Optional filename for the attachment (defaults to basename of path)" }
            },
            required: ["to", "subject", "body"]
        }
    },
    {
        name: "generate_pdf",
        description: "Generate a professionally formatted PDF document. IMPORTANT formatting rules for the 'content' field: use \\n for line breaks between paragraphs, use • or - at the start of a line for bullet points (each on its own line). Do NOT use ** or any markdown bold — write naturally clean text. Break each major topic into its own section object with a heading. Never concatenate unrelated content into a single paragraph — use separate lines. Example content: \"Overview paragraph here.\\n\\nKey Highlights:\\n• First point with detail\\n• Second point with detail\\n\\nConclusion paragraph.\"",
        input_schema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Document title" },
                subtitle: { type: "string", description: "Optional subtitle (defaults to date)" },
                sections: {
                    type: "array",
                    description: "Array of sections. Use MANY sections with clear headings rather than few dense ones. Each section has optional heading, content (with \\n line breaks, • bullets, **bold**), and table.",
                    items: {
                        type: "object",
                        properties: {
                            heading: { type: "string", description: "Section heading" },
                            content: { type: "string", description: "Section content. Use \\n between lines. Start bullet lines with • or -. No markdown formatting — write clean natural text. Each bullet point must be on its own line." },
                            table: {
                                type: "object",
                                properties: {
                                    headers: { type: "array", items: { type: "string" } },
                                    rows: { type: "array", items: { type: "array", items: { type: "string" } } }
                                }
                            }
                        }
                    }
                },
                footer: { type: "string", description: "Optional footer text" },
                filename: { type: "string", description: "Optional filename (without path). Defaults to report_<timestamp>.pdf" }
            },
            required: ["title", "sections"]
        }
    },
    {
        name: "schedule_task",
        description: "Schedule a task to run at a specific time or interval",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Task name" },
                cron_expression: { type: "string", description: "Cron expression (e.g., '0 9 * * *' for 9am daily)" },
                task_description: { type: "string", description: "What the task should do" }
            },
            required: ["name", "cron_expression", "task_description"]
        }
    },
    {
        name: "delete_task",
        description: "Delete a scheduled task by name",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Task name to delete" }
            },
            required: ["name"]
        }
    },
    {
        name: "generate_image",
        description: "Generate an image using DALL-E 3. Provide a detailed prompt describing the desired image. Returns the file path of the saved image.",
        input_schema: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Detailed description of the image to generate" },
                size: { type: "string", description: "Image size: '1024x1024', '1792x1024', or '1024x1792'", enum: ["1024x1024", "1792x1024", "1024x1792"] },
                quality: { type: "string", description: "Image quality: 'standard' or 'hd'", enum: ["standard", "hd"] }
            },
            required: ["prompt"]
        }
    },
    {
        name: "generate_chart",
        description: "Run any Python script for data analysis, calculations, graphs, charts, visualisations, tables, or any computation. Has access to: numpy, pandas, matplotlib, seaborn, plotly, altair, scipy, scikit-learn, requests, json, csv, datetime, math, statistics, os. For matplotlib/seaborn: save PNG using plt.savefig(output_path, dpi=150, bbox_inches='tight'). For plotly: use fig.write_image(output_path). For altair: use chart.save(output_path). All produce images sent as photos in Telegram. For text-only data output, use print(). Use this tool whenever you need to calculate, analyse data, produce graphs, run simulations, or do any Python work.",
        input_schema: {
            type: "object",
            properties: {
                python_code: { type: "string", description: "Complete Python script. For visuals: use plt.savefig(output_path, dpi=150, bbox_inches='tight'). The variable 'output_path' is injected automatically. For text output: use print()." },
                filename: { type: "string", description: "Output filename (e.g. 'analysis.png'). Saved to ~/.alex/outputs/charts/" },
                caption: { type: "string", description: "Caption to display with the output in Telegram" }
            },
            required: ["python_code", "filename"]
        }
    },
    {
        name: "create_skill",
        description: "Create a new skill that extends your capabilities",
        input_schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Skill name (lowercase, hyphenated)" },
                content: { type: "string", description: "SKILL.md content defining the skill" }
            },
            required: ["name", "content"]
        }
    },
    {
        name: "update_dashboard",
        description: "Update the NAVADA activity dashboard. Use this to log tasks, post news/insights, update metrics, log activity, or update service status. Actions: add_task, update_task, update_metrics, add_news, add_activity, update_services, set_status.",
        input_schema: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    description: "Action to perform: 'add_task' (log a new task), 'update_task' (update existing task by name), 'update_metrics' (set token/cost metrics), 'add_news' (post a news item/insight), 'add_activity' (log an activity entry), 'update_services' (update service list), 'set_status' (set online/offline)",
                    enum: ["add_task", "update_task", "update_metrics", "add_news", "add_activity", "update_services", "set_status"]
                },
                task: {
                    type: "object",
                    description: "For add_task: {name, category, status, tokens, cost, time}",
                    properties: {
                        name: { type: "string" },
                        category: { type: "string", description: "e.g. research, automation, infrastructure, email, report, creative" },
                        status: { type: "string", enum: ["completed", "in_progress", "failed", "pending"] },
                        tokens: { type: "number" },
                        cost: { type: "string" },
                        time: { type: "string" }
                    }
                },
                name: { type: "string", description: "For update_task: task name to update" },
                updates: { type: "object", description: "For update_task: fields to update" },
                metrics: {
                    type: "object",
                    description: "For update_metrics: {total_tokens, avg_tokens_per_task, total_api_calls, est_session_cost}",
                    properties: {
                        total_tokens: { type: "number" },
                        avg_tokens_per_task: { type: "number" },
                        total_api_calls: { type: "number" },
                        est_session_cost: { type: "string" }
                    }
                },
                item: {
                    type: "object",
                    description: "For add_news: {headline, summary, severity (high/medium/low/info), source}",
                    properties: {
                        headline: { type: "string" },
                        summary: { type: "string" },
                        severity: { type: "string", enum: ["high", "medium", "low", "info"] },
                        source: { type: "string" }
                    }
                },
                entry: { type: "string", description: "For add_activity: activity text to log" },
                services: {
                    type: "array",
                    description: "For update_services: [{name, port, status}]",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            port: { type: "string" },
                            status: { type: "string", enum: ["running", "stopped"] }
                        }
                    }
                },
                status: { type: "string", description: "For set_status: 'online' or 'offline'" }
            },
            required: ["action"]
        }
    },
    {
        name: "send_file",
        description: "Send ANY file from the Pi to the user via Telegram. Use for images (PNG, JPG, GIF, SVG), documents (PDF, TXT, CSV, JSON, MD), code files, logs, reports — anything. Images are sent as photos, everything else as documents. Use this whenever the user asks to see, retrieve, or get a file.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file (e.g. /home/head/clawd/README.md, /home/head/.alex/outputs/images/image_123.png)" },
                caption: { type: "string", description: "Optional caption or description to show with the file" }
            },
            required: ["path"]
        }
    },
    {
        name: "send_voice_message",
        description: "Convert text to speech and send as a Telegram voice message. Use when user asks to 'talk to me', wants a voice response, or asks for audio.",
        input_schema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The text to convert to speech" }
            },
            required: ["text"]
        }
    },
    {
        name: "send_slack_message",
        description: "Send a message to Slack. Use 'default' for main channel, 'owner' for Lee's DM, or a specific channel ID.",
        input_schema: {
            type: "object",
            properties: {
                channel: { type: "string", description: "Channel: 'default', 'owner', or channel ID" },
                message: { type: "string", description: "Message text to send" },
                thread_ts: { type: "string", description: "Optional thread timestamp for replies" }
            },
            required: ["channel", "message"]
        }
    },
    {
        name: "get_recent_uploads",
        description: "Get list of files recently uploaded by the user in this chat (photos, documents). Returns file paths that can be used with send_email attachment_path.",
        input_schema: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "stock_quote",
        description: "Get real-time stock price, change, and volume for a ticker symbol. Uses Alpha Vantage.",
        input_schema: {
            type: "object",
            properties: {
                symbol: { type: "string", description: "Stock ticker symbol (e.g. AAPL, TSLA, MSFT)" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "stock_search",
        description: "Search for stock ticker symbols by company name or keyword. Uses Alpha Vantage.",
        input_schema: {
            type: "object",
            properties: {
                keywords: { type: "string", description: "Search keywords (e.g. 'Tesla', 'Microsoft')" }
            },
            required: ["keywords"]
        }
    },
    {
        name: "company_overview",
        description: "Get company fundamentals: market cap, P/E ratio, EPS, sector, description, dividend yield, 52-week range. Uses Alpha Vantage.",
        input_schema: {
            type: "object",
            properties: {
                symbol: { type: "string", description: "Stock ticker symbol (e.g. AAPL, TSLA)" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "market_news",
        description: "Get latest market news and sentiment. Can filter by tickers or topics. Uses Alpha Vantage.",
        input_schema: {
            type: "object",
            properties: {
                tickers: { type: "string", description: "Comma-separated ticker symbols (e.g. 'AAPL,TSLA')" },
                topics: { type: "string", description: "Topics to filter by (e.g. 'technology', 'earnings', 'ipo', 'mergers_and_acquisitions', 'financial_markets', 'economy_fiscal', 'economy_monetary', 'economy_macro', 'energy_transportation', 'finance', 'life_sciences', 'manufacturing', 'real_estate', 'retail_wholesale', 'blockchain')" }
            }
        }
    },
    {
        name: "crypto_rate",
        description: "Get current cryptocurrency exchange rate. Uses Alpha Vantage.",
        input_schema: {
            type: "object",
            properties: {
                symbol: { type: "string", description: "Crypto symbol (e.g. BTC, ETH, SOL)" },
                market: { type: "string", description: "Market currency (default: USD)" }
            },
            required: ["symbol"]
        }
    },
    {
        name: "economic_indicator",
        description: "Get US economic indicator data: GDP, inflation, unemployment, interest rates, etc. Uses Alpha Vantage.",
        input_schema: {
            type: "object",
            properties: {
                function: { type: "string", description: "Indicator function: REAL_GDP, REAL_GDP_PER_CAPITA, INFLATION, INFLATION_EXPECTATION, CONSUMER_SENTIMENT, RETAIL_SALES, DURABLES, UNEMPLOYMENT, NONFARM_PAYROLL, TREASURY_YIELD, FEDERAL_FUNDS_RATE, CPI" }
            },
            required: ["function"]
        }
    },
    {
        name: "confirm_delete",
        description: "Execute a file deletion command ONLY after the user has confirmed 3 times AND provided the correct delete password. You MUST have received 3 explicit confirmations and the correct password in the conversation before calling this tool. Never call this without all 4 requirements met.",
        input_schema: {
            type: "object",
            properties: {
                command: { type: "string", description: "The delete command to execute (rm, rmdir, etc.)" },
                password: { type: "string", description: "The delete password provided by the user" }
            },
            required: ["command", "password"]
        }
    },
    {
        name: "generate_diagram",
        description: "Generate a diagram from Mermaid syntax. Renders to PNG and sends as photo. Supports flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, Gantt charts, pie charts, and more.",
        input_schema: {
            type: "object",
            properties: {
                mermaid_code: { type: "string", description: "Mermaid diagram syntax (e.g. 'graph TD\\n    A-->B')" },
                filename: { type: "string", description: "Optional output filename (default: auto-generated)" }
            },
            required: ["mermaid_code"]
        }
    },
    {
        name: "generate_mindmap",
        description: "Generate a mind map from a markdown outline. Renders to PNG and sends as photo. Use nested markdown headings or bullet lists to define the hierarchy.",
        input_schema: {
            type: "object",
            properties: {
                markdown: { type: "string", description: "Markdown outline with headings/bullets defining the mind map hierarchy" },
                filename: { type: "string", description: "Optional output filename (default: auto-generated)" }
            },
            required: ["markdown"]
        }
    },
    {
        name: "generate_webapp",
        description: "Generate a self-contained single-file HTML web application and send as file attachment. For interactive dashboards, data tables, reports with filtering/sorting, calculators, or visual content needing interaction. Must be complete HTML with inline CSS/JS. Use Tailwind CDN (<script src=\"https://cdn.tailwindcss.com\"></script>) for styling. For static charts use generate_chart instead.",
        input_schema: {
            type: "object",
            properties: {
                html_code: { type: "string", description: "Complete self-contained HTML document with inline CSS and JavaScript." },
                filename: { type: "string", description: "Output filename (e.g. 'dashboard.html'). Saved to ~/.alex/outputs/webapps/" },
                caption: { type: "string", description: "Caption for Telegram message" }
            },
            required: ["html_code", "filename"]
        }
    },
    {
        name: "manage_user",
        description: "Add or remove Telegram users, and grant or revoke full Pi access. Changes take effect immediately without restart.",
        input_schema: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["add", "remove", "list"], description: "Action to perform" },
                user_id: { type: "number", description: "Telegram user ID (required for add/remove)" },
                full_access: { type: "boolean", description: "Whether to grant full owner-level access (for add action)" }
            },
            required: ["action"]
        }
    },
    {
        name: "linkedin_post",
        description: "Post to LinkedIn. Creates a text post on the user's LinkedIn profile. Only use when the user explicitly asks to post to LinkedIn. Max 3000 characters.",
        input_schema: {
            type: "object",
            properties: {
                text: { type: "string", description: "The post text content (max 3000 characters)" },
                link_url: { type: "string", description: "Optional URL to attach as a link preview" },
                image_path: { type: "string", description: "Optional absolute path to an image file to attach to the post" }
            },
            required: ["text"]
        }
    },
    {
        name: "calendar_list_events",
        description: "List upcoming Google Calendar events. Returns event summaries, times, locations, and attendees.",
        input_schema: {
            type: "object",
            properties: {
                max_results: { type: "number", description: "Maximum number of events to return (default: 10)" },
                time_min: { type: "string", description: "Start of time range in ISO 8601 format (default: now)" },
                time_max: { type: "string", description: "End of time range in ISO 8601 format" }
            }
        }
    },
    {
        name: "calendar_create_event",
        description: "Create a new Google Calendar event. Provide summary, start/end times (ISO 8601), and optional description, location, attendees.",
        input_schema: {
            type: "object",
            properties: {
                summary: { type: "string", description: "Event title" },
                start_time: { type: "string", description: "Start time in ISO 8601 format (e.g. 2025-01-15T14:00:00)" },
                end_time: { type: "string", description: "End time in ISO 8601 format (e.g. 2025-01-15T15:00:00)" },
                description: { type: "string", description: "Event description" },
                location: { type: "string", description: "Event location" },
                attendees: { type: "array", items: { type: "string" }, description: "List of attendee email addresses" }
            },
            required: ["summary", "start_time", "end_time"]
        }
    },
    {
        name: "calendar_update_event",
        description: "Update an existing Google Calendar event by ID. Only provided fields are changed.",
        input_schema: {
            type: "object",
            properties: {
                event_id: { type: "string", description: "Google Calendar event ID" },
                summary: { type: "string", description: "New event title" },
                start_time: { type: "string", description: "New start time in ISO 8601 format" },
                end_time: { type: "string", description: "New end time in ISO 8601 format" },
                description: { type: "string", description: "New event description" },
                location: { type: "string", description: "New event location" }
            },
            required: ["event_id"]
        }
    },
    {
        name: "calendar_delete_event",
        description: "Delete a Google Calendar event by ID.",
        input_schema: {
            type: "object",
            properties: {
                event_id: { type: "string", description: "Google Calendar event ID to delete" }
            },
            required: ["event_id"]
        }
    },
    {
        name: "fetch_url",
        description: "Fetch any URL and return the response body. Use for API calls, web scraping, downloading data, checking endpoints. Supports GET and POST with custom headers and body.",
        input_schema: {
            type: "object",
            properties: {
                url: { type: "string", description: "The URL to fetch (e.g. https://api.github.com)" },
                method: { type: "string", description: "HTTP method (default: GET)", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
                headers: { type: "object", description: "Optional HTTP headers as key-value pairs" },
                body: { type: "string", description: "Optional request body (for POST/PUT/PATCH)" }
            },
            required: ["url"]
        }
    },
    {
        name: "tiktok_scrape",
        description: "Scrape TikTok videos by hashtag, profile, search query, or video URL. Returns video metadata including views, likes, shares, author info.",
        input_schema: {
            type: "object",
            properties: {
                hashtags: { type: "array", items: { type: "string" }, description: "Hashtags to scrape (without #)" },
                profiles: { type: "array", items: { type: "string" }, description: "TikTok usernames to scrape" },
                searchQueries: { type: "array", items: { type: "string" }, description: "Search terms" },
                videoUrls: { type: "array", items: { type: "string" }, description: "Specific TikTok video URLs" },
                resultsPerPage: { type: "number", description: "Number of results (default 20, max 100)" }
            }
        }
    },
    {
        name: "tiktok_download",
        description: "Download a TikTok video by URL and send it via Telegram. Use after tiktok_scrape to get actual video files.",
        input_schema: {
            type: "object",
            properties: {
                url: { type: "string", description: "TikTok video URL (e.g. https://tiktok.com/@user/video/123)" },
                caption: { type: "string", description: "Optional caption for the video" }
            },
            required: ["url"]
        }
    },
    {
        name: "linkedin_posts_search",
        description: "Search LinkedIn posts by keyword. Returns post content, author details, reactions, comments count, and media attachments. Supports OR operator and exact matching with quotes. Cost: ~$5 per 1,000 results.",
        input_schema: {
            type: "object",
            properties: {
                searchKeyword: { type: "string", description: "Keywords to search. Supports OR operator and exact matching with quotes. Example: 'AI OR Javascript' or '\"hiring\" OR \"growth\"'" },
                sortType: { type: "string", description: "Sort by: 'Relevance' or 'Date' (default: Relevance)", enum: ["Relevance", "Date"] },
                pageNumber: { type: "number", description: "Page number (default: 1)" },
                dateFilter: { type: "string", description: "Filter by date: 'past-24h', 'past-week', 'past-month', or null", enum: ["past-24h", "past-week", "past-month"] },
                resultLimit: { type: "number", description: "Max results to return (default: 50, max: 100)" }
            },
            required: ["searchKeyword"]
        }
    },
    {
        name: "indeed_job_search",
        description: "Search Indeed job listings by position and location. Returns job titles, companies, salaries, locations, and application URLs. Cost: ~$5 per 1,000 jobs.",
        input_schema: {
            type: "object",
            properties: {
                position: { type: "string", description: "Job title or keywords to search for. Example: 'web developer', 'data scientist'" },
                country: { type: "string", description: "Country to search in (default: United Kingdom). Options: United States, United Kingdom, Canada, Australia, Germany, etc." },
                location: { type: "string", description: "City or region. Example: 'London', 'Remote', 'San Francisco'" },
                maxItems: { type: "number", description: "Maximum jobs to return (default: 100, max: 200)" },
                scrapeCompanyDetails: { type: "boolean", description: "Scrape additional company info (slower, default: false)" },
                saveOnlyUniqueJobs: { type: "boolean", description: "Filter duplicate listings (default: true)" }
            },
            required: ["position"]
        }
    },
    {
        name: "google_maps_leads",
        description: "Search Google Maps for businesses and extract leads with contact enrichment. Returns business info (name, address, phone, website, email, rating) plus employee contacts (name, job title, work email, LinkedIn). Cost: ~$4/1000 places + $0.005/lead.",
        input_schema: {
            type: "object",
            properties: {
                searchTerms: {
                    type: "array",
                    items: { type: "string" },
                    description: "What to search for. Examples: ['tech startup', 'software company'], ['fintech'], ['SaaS company']"
                },
                location: {
                    type: "string",
                    description: "Where to search. Example: 'London, UK', 'Manchester, UK', 'New York, USA'"
                },
                maxResults: {
                    type: "number",
                    description: "Maximum places per search term (default: 20, max: 100)"
                },
                scrapeContacts: {
                    type: "boolean",
                    description: "Enable company contact enrichment - emails, phone from website (default: true)"
                },
                maxLeadsPerPlace: {
                    type: "number",
                    description: "Employee leads per company (default: 3, max: 10)"
                },
                leadsDepartments: {
                    type: "array",
                    items: { type: "string" },
                    description: "Departments to find contacts from. Default: ['C-Suite', 'Engineering & Technical', 'Information Technology']. Options: 'C-Suite', 'Sales', 'Marketing', 'Engineering & Technical', 'Information Technology', 'Human Resources', 'Finance', 'Operations'"
                }
            },
            required: ["searchTerms", "location"]
        }
    },
    {
        name: "glassdoor_scrape",
        description: "Scrape Glassdoor for company reviews, salaries, interviews, and benefits. Accepts company URL or search query. Cost: ~$5 per 1,000 results.",
        input_schema: {
            type: "object",
            properties: {
                startUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Glassdoor company URLs to scrape (e.g. https://www.glassdoor.com/Overview/Working-at-Google-EI_IE9079.htm)"
                },
                searchQuery: {
                    type: "string",
                    description: "Company name to search for (e.g. 'Google', 'Microsoft')"
                },
                scrapeReviews: { type: "boolean", description: "Scrape employee reviews (default: true)" },
                scrapeInterviews: { type: "boolean", description: "Scrape interview experiences (default: true)" },
                scrapeSalaries: { type: "boolean", description: "Scrape salary data (default: true)" },
                scrapeBenefits: { type: "boolean", description: "Scrape benefits info (default: true)" },
                maxItems: { type: "number", description: "Max results to return (default: 50, max: 100)" }
            }
        }
    },
    {
        name: "linkedin_profile_scrape",
        description: "Scrape LinkedIn profile details including name, headline, location, work experience, education, certifications, and optional email addresses. Cost: ~$5 per 1,000 profiles.",
        input_schema: {
            type: "object",
            properties: {
                profiles: {
                    type: "array",
                    items: { type: "string" },
                    description: "LinkedIn profile usernames or full URLs (e.g. ['johndoe', 'https://linkedin.com/in/janedoe'])"
                },
                searchForEmail: {
                    type: "boolean",
                    description: "Search for email addresses associated with profiles (default: true)"
                }
            },
            required: ["profiles"]
        }
    }
];

// ============================================================================
// TOOL EXECUTION
// ============================================================================

/**
 * Mask sensitive values in tool output (API keys, passwords, tokens, secrets)
 */
export function maskSensitive(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/\b(sk-ant-[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]+/g, '$1xxxxxxxxxxxx')
        .replace(/\b(sk-proj-[a-zA-Z0-9_-]{6})[a-zA-Z0-9_-]+/g, '$1xxxxxxxxxxxx')
        .replace(/\b(sk-[a-zA-Z0-9]{6})[a-zA-Z0-9]+/g, '$1xxxxxxxxxxxx')
        .replace(/\b(xoxb-[a-zA-Z0-9-]{6})[a-zA-Z0-9-]+/g, '$1xxxxxxxxxxxx')
        .replace(/\b([a-z]{4}) [a-z]{4} [a-z]{4} [a-z]{4}\b/g, '$1 xxxx xxxx xxxx')
        .replace(/"(api_key|api_token|password|secret|token|app_password|redis_token|control_api_token)"\s*:\s*"([^"]{4})[^"]+"/gi,
            '"$1": "$2xxxxxxxxxxxx"')
        .replace(/\b(\d{8,12}:AA[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1xxxxxxxxxxxx')
        .replace(/"(linkedin_access_token|linkedin_refresh_token|linkedin_client_secret)"\s*:\s*"([^"]{4})[^"]+"/gi,
            '"$1": "$2xxxxxxxxxxxx"')
        .replace(/"(google_calendar_access_token|google_calendar_refresh_token|google_calendar_client_secret)"\s*:\s*"([^"]{4})[^"]+"/gi,
            '"$1": "$2xxxxxxxxxxxx"');
}

// Users with full owner-level access (for testing/delegation)
export const FULL_ACCESS_USERS = new Set();

// Owner-only tools — non-owners get NO access to the Pi whatsoever
// Only safe conversational tools (web_lookup, memory_recall, web_search) are open to all
const OWNER_ONLY_TOOLS = new Set([
    'bash', 'read_file', 'write_file', 'edit_file', 'list_directory', 'grep', 'glob',
    'send_email', 'schedule_task', 'delete_task', 'confirm_delete', 'fetch_url',
    'generate_pdf', 'generate_image', 'create_skill',
    'send_file', 'send_voice_message', 'send_slack_message', 'update_dashboard', 'memory_save',
    'manage_user', 'generate_webapp', 'linkedin_post',
    'calendar_list_events', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event',
    'tiktok_scrape',
    'tiktok_download',
    'linkedin_posts_search',
    'indeed_job_search',
    'google_maps_leads',
    'glassdoor_scrape',
    'linkedin_profile_scrape',
]);

// Per-tool timeout limits (milliseconds)
const TOOL_TIMEOUTS = {
    bash: 300000,
    generate_chart: 180000,
    generate_diagram: 60000,
    generate_mindmap: 60000,
    generate_image: 60000,
    generate_pdf: 30000,
    fetch_url: 30000,
    tiktok_scrape: 180000,
    tiktok_download: 120000,
    linkedin_posts_search: 180000,
    linkedin_profile_scrape: 180000,
    indeed_job_search: 180000,
    google_maps_leads: 300000,  // 5 minutes - lead enrichment takes time
    glassdoor_scrape: 180000,
};
const DEFAULT_TOOL_TIMEOUT = 30000;

function withTimeout(name, promise) {
    const timeout = TOOL_TIMEOUTS[name] || DEFAULT_TOOL_TIMEOUT;
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Tool '${name}' timed out after ${timeout / 1000}s`)), timeout)
        )
    ]);
}

export async function executeTool(name, input, { memory, skills, config, scheduledTasks, handleScheduledTask, openaiClient, bot, callerUserId }) {
    console.log(`[TOOL] Executing: ${name}`, JSON.stringify(input).substring(0, 200));

    // Tiered permissions: sensitive tools are owner-only
    if (OWNER_ONLY_TOOLS.has(name) && config.telegram_owner_id && callerUserId) {
        if (callerUserId !== config.telegram_owner_id && !FULL_ACCESS_USERS.has(callerUserId)) {
            console.log(`[TOOL] Permission denied: ${name} is owner-only (caller: ${callerUserId})`);
            return { success: false, error: `Permission denied: '${name}' is restricted to the account owner.` };
        }
    }

    try {
        // Tools that manage their own timeouts internally (bash, generate_chart) skip the outer wrapper
        const needsOuterTimeout = !['bash', 'generate_chart', 'generate_diagram', 'generate_mindmap'].includes(name);
        const executeSwitch = async () => {
        switch (name) {
            case 'bash': {
                // Guardrail: block destructive and dangerous operations
                const cmd = input.command;
                const destructivePatterns = /\brm\s|rmdir\s|unlink\s|shred\s|\brm\b.*-rf|\brm\b.*-r/i;
                const dangerousPatterns = [
                    /\bmkfs\b/i,
                    /\bdd\b.*\bof\s*=\s*\/dev\//i,
                    /\bcurl\b.*\|\s*(ba)?sh\b/i,
                    /\bwget\b.*\|\s*(ba)?sh\b/i,
                    /\bsudo\s+rm\b/i,
                    /\breboot\b/i,
                    /\bshutdown\b/i,
                    /\bpoweroff\b/i,
                    /\bsystemctl\s+(stop|disable)\s+alex\b/i,
                    /\b>\s*\/dev\/sd[a-z]/i,
                    /\bchmod\s+777\s+\//i,
                    /\bchown\s.*\s+\//i,
                ];
                if (dangerousPatterns.some(p => p.test(cmd))) {
                    return {
                        success: false,
                        error: 'BLOCKED: This command is considered dangerous and has been blocked for safety.'
                    };
                }
                if (destructivePatterns.test(cmd)) {
                    return {
                        success: false,
                        error: 'DELETE_GUARDRAIL: This command would delete files. You MUST ask the user to confirm 3 times AND provide the delete password before executing any file deletion. Ask: "This will delete files. Are you sure? (Confirmation 1 of 3)" — then ask twice more — then ask: "Please provide the delete password to proceed." The password must match exactly. Do NOT proceed without all 3 confirmations and the correct password.'
                    };
                }
                const options = {
                    cwd: input.working_directory || os.homedir(),
                    timeout: input.timeout || 300000,
                    maxBuffer: 50 * 1024 * 1024
                };
                const { stdout, stderr } = await execAsync(input.command, options);
                return { success: true, stdout: maskSensitive(stdout), stderr: maskSensitive(stderr) };
            }

            case 'read_file': {
                const ext = path.extname(input.path).toLowerCase();
                if (ext === '.pdf') {
                    // Extract text from PDF instead of reading raw binary
                    const { stdout } = await execAsync(`pdftotext "${input.path}" -`, { maxBuffer: 5 * 1024 * 1024, timeout: 15000 });
                    const text = stdout.substring(0, 200000); // cap at 200k chars
                    return { success: true, content: maskSensitive(text), note: text.length >= 200000 ? 'Truncated to 200,000 characters' : undefined };
                }
                const content = await fs.readFile(input.path, 'utf-8');
                return { success: true, content: maskSensitive(content.substring(0, 500000)) };
            }

            case 'write_file': {
                if (!isPathAllowed(input.path, ALLOWED_WRITE_PATHS)) {
                    return { success: false, error: `Write denied: path must be within ${ALLOWED_WRITE_PATHS.join(' or ')}` };
                }
                await fs.mkdir(path.dirname(input.path), { recursive: true });
                await fs.writeFile(input.path, input.content);
                return { success: true, message: `Written to ${input.path}` };
            }

            case 'list_directory': {
                const entries = await fs.readdir(input.path, { withFileTypes: true });
                const items = entries.map(e => ({
                    name: e.name,
                    type: e.isDirectory() ? 'directory' : 'file'
                }));
                return { success: true, items };
            }

            case 'grep': {
                const maxResults = input.max_results || 50;
                const args = ['-rn', '--color=never', '-m', String(maxResults * 5)];
                if (input.include) args.push('--include', input.include);
                args.push(input.pattern, input.path);
                try {
                    const { stdout } = await execAsync(`grep ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
                    const lines = stdout.trim().split('\n').filter(l => l).slice(0, maxResults).map(l => maskSensitive(l));
                    return { success: true, matches: lines, count: lines.length };
                } catch (err) {
                    if (err.code === 1) return { success: true, matches: [], count: 0, note: 'No matches found' };
                    return { success: false, error: err.message };
                }
            }

            case 'glob': {
                try {
                    const { stdout } = await execAsync(`find ${JSON.stringify(input.path)} -path ${JSON.stringify(input.pattern.startsWith('*') ? input.path + '/' + input.pattern : input.pattern)} -type f 2>/dev/null | head -100`, { timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
                    const files = stdout.trim().split('\n').filter(l => l);
                    return { success: true, files, count: files.length };
                } catch {
                    // Fallback: use bash globstar
                    try {
                        const { stdout } = await execAsync(`bash -c 'shopt -s globstar; ls -1 ${input.path}/${input.pattern} 2>/dev/null | head -100'`, { timeout: 15000 });
                        const files = stdout.trim().split('\n').filter(l => l);
                        return { success: true, files, count: files.length };
                    } catch (err2) {
                        return { success: true, files: [], count: 0, note: 'No files found' };
                    }
                }
            }

            case 'edit_file': {
                const content = await fs.readFile(input.path, 'utf-8');
                if (!content.includes(input.old_text)) {
                    return { success: false, error: 'old_text not found in file. Make sure it matches exactly (including whitespace).' };
                }
                const updated = content.replace(input.old_text, input.new_text);
                if (!isPathAllowed(input.path, ALLOWED_WRITE_PATHS)) {
                    return { success: false, error: `Write denied: path must be within ${ALLOWED_WRITE_PATHS.join(' or ')}` };
                }
                await fs.writeFile(input.path, updated);
                return { success: true, message: `Edited ${input.path}`, chars_changed: input.new_text.length - input.old_text.length };
            }

            case 'web_lookup': {
                return await webLookup(input.query);
            }

            case 'memory_save': {
                await memory.appendMemory(input.category, input.content);
                return { success: true, message: `Saved to ${input.category} memory` };
            }

            case 'memory_recall': {
                const content = await memory.getMemory(input.category);
                return { success: true, content: content || 'No memories in this category yet.' };
            }

            case 'send_email': {
                if (input.to && input.to.endsWith('@navada.ai')) {
                    return { success: false, error: 'Invalid domain. Use lee@navada.info instead.' };
                }
                if (input.attachment_path && !isPathAllowed(input.attachment_path, ALLOWED_ATTACHMENT_PATHS)) {
                    return { success: false, error: `Attachment denied: path must be within ${ALLOWED_ATTACHMENT_PATHS.join(' or ')}` };
                }
                const ccEmail = config.auto_cc_email || 'lee@navada.info';
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        user: config.gmail_address,
                        pass: config.gmail_app_password
                    }
                });

                // Convert markdown to basic HTML if body is plain text
                let emailBody = input.body || 'No content';
                if (!emailBody.includes('<') || !emailBody.includes('>')) {
                    emailBody = emailBody
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')
                        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
                        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
                        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
                        .replace(/^[-—] (.*$)/gm, '<li>$1</li>')
                        .replace(/\n\n/g, '</p><p>')
                        .replace(/\n/g, '<br>');
                    emailBody = `<p>${emailBody}</p>`;
                }

                const templateDir = path.join(WORKSPACE_PATH, 'templates');

                if (input.template) {
                    // Load template + signature
                    try {
                        let tpl = await fs.readFile(path.join(templateDir, `${input.template}.html`), 'utf-8');
                        const sig = await fs.readFile(path.join(templateDir, 'signature.html'), 'utf-8');
                        tpl = tpl.replace('{{CONTENT}}', emailBody);
                        tpl = tpl.replace('{{SIGNATURE}}', sig);
                        tpl = tpl.replace('{{DATE}}', new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
                        tpl = tpl.replace('{{TITLE}}', input.subject || '');
                        tpl = tpl.replace('{{SUBTITLE}}', '');
                        emailBody = tpl;
                    } catch (tplErr) {
                        console.error('[EMAIL] Template load error:', tplErr.message);
                        return { success: false, error: `Template '${input.template}' not found: ${tplErr.message}` };
                    }
                } else {
                    // Default: wrap in styled container with signature (hosted logo for Gmail compatibility)
                    const sigHtml = `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 24px;">
                        <tr><td style="border-top: 1px solid #e8e8e8; padding-top: 20px;">
                            <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; color: #1a1a1a; font-weight: bold; letter-spacing: 0.3px;">ALEX</span><br>
                            <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 13px; color: #555; letter-spacing: 0.3px;">Global Economist, NAVADA</span><br>
                            <a href="https://alexnavada.xyz" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">alexnavada.xyz</a>
                            <span style="font-size: 12px; color: #ccc;">&nbsp;&bull;&nbsp;</span>
                            <a href="https://www.navada.space" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">navada.space</a>
                            <span style="font-size: 12px; color: #ccc;">&nbsp;&bull;&nbsp;</span>
                            <a href="https://www.raventerminal.xyz" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">raventerminal.xyz</a>
                            <span style="font-size: 12px; color: #ccc;">&nbsp;&bull;&nbsp;</span>
                            <a href="https://www.navadarobotics.com" style="font-family: Georgia, 'Times New Roman', serif; font-size: 12px; color: #888; text-decoration: none;">navadarobotics.com</a>
                        </td></tr>
                    </table>`;
                    emailBody = `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.7; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 20px;">
                        ${emailBody}
                        ${sigHtml}
                    </div>`;
                }

                const mailOptions = {
                    from: `"ALEX — NAVADA" <${config.gmail_address}>`,
                    to: input.to || config.recipient_email,
                    cc: ccEmail,
                    subject: input.subject || 'Message from ALEX',
                    html: emailBody,
                    attachments: []
                };

                if (input.attachment_path) {
                    mailOptions.attachments.push({
                        filename: input.attachment_filename || path.basename(input.attachment_path),
                        path: input.attachment_path
                    });
                }

                await transporter.sendMail(mailOptions);
                return { success: true, message: `Email sent to ${input.to || config.recipient_email} (CC: ${ccEmail})${input.template ? ` [${input.template} template]` : ''}${input.attachment_path ? ' with attachment' : ''}` };
            }

            case 'generate_pdf': {
                const timestamp = Date.now();
                const filename = input.filename || `report_${timestamp}.pdf`;
                const reportsDir = path.join(WORKSPACE_PATH, 'outputs', 'reports');
                await fs.mkdir(reportsDir, { recursive: true });
                const outputPath = path.join(reportsDir, filename);

                const tmpJson = path.join(reportsDir, `_tmp_${timestamp}.json`);
                const pdfData = {
                    title: input.title,
                    subtitle: input.subtitle || '',
                    sections: input.sections || [],
                    footer: input.footer || 'NAVADA — Confidential'
                };
                await fs.writeFile(tmpJson, JSON.stringify(pdfData));

                const scriptPath = path.join(WORKSPACE_PATH, 'scripts', 'generate_pdf.py');
                await new Promise((resolve, reject) => {
                    execFile('python3', [scriptPath, tmpJson, outputPath], { timeout: 30000 }, (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                await fs.unlink(tmpJson).catch(() => {});
                return { success: true, path: outputPath, message: `PDF generated: ${outputPath}` };
            }

            case 'schedule_task': {
                const tasksDir = path.join(WORKSPACE_PATH, 'tasks');
                await fs.mkdir(tasksDir, { recursive: true });
                const taskFile = path.join(tasksDir, `${input.name}.json`);
                await fs.writeFile(taskFile, JSON.stringify(input, null, 2));

                // Update system cron file for user tasks
                const cronFile = '/etc/cron.d/alex-tasks';
                const cronLine = `# ${input.name}\n${input.cron_expression}  head  curl -sf --retry 3 --retry-delay 30 --retry-connrefused -X POST http://127.0.0.1:9090/api/trigger -H 'Content-Type: application/json' -d '{"task":"${input.name}"}' >> /home/head/.alex/logs/cron.log 2>&1\n`;
                try {
                    let existing = '';
                    try { existing = await fs.readFile(cronFile, 'utf-8'); } catch {}
                    // Remove old entry for this task if present
                    const lines = existing.split('\n');
                    const filtered = [];
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i] === `# ${input.name}`) { i++; continue; } // skip comment + cron line
                        if (lines[i].trim()) filtered.push(lines[i]);
                    }
                    const header = 'SHELL=/bin/bash\nPATH=/usr/local/bin:/usr/bin:/bin\n';
                    const newContent = header + '\n' + filtered.filter(l => l !== 'SHELL=/bin/bash' && l !== 'PATH=/usr/local/bin:/usr/bin:/bin').join('\n') + '\n' + cronLine;
                    await fs.writeFile(cronFile, newContent);
                } catch (cronErr) {
                    console.error('[CRON] Failed to update cron file:', cronErr.message);
                    // Task JSON is saved, cron file update failed — not fatal
                }

                scheduledTasks.set(input.name, true);
                return { success: true, message: `Task '${input.name}' scheduled with cron: ${input.cron_expression}` };
            }

            case 'delete_task': {
                const taskFile = path.join(WORKSPACE_PATH, 'tasks', `${input.name}.json`);
                try { await fs.unlink(taskFile); } catch {}

                // Remove from cron file
                const cronFile = '/etc/cron.d/alex-tasks';
                try {
                    const existing = await fs.readFile(cronFile, 'utf-8');
                    const lines = existing.split('\n');
                    const filtered = [];
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i] === `# ${input.name}`) { i++; continue; }
                        filtered.push(lines[i]);
                    }
                    await fs.writeFile(cronFile, filtered.join('\n'));
                } catch {}

                scheduledTasks.delete(input.name);
                return { success: true, message: `Task '${input.name}' deleted` };
            }

            case 'generate_image': {
                if (!openaiClient) {
                    return { success: false, error: 'OpenAI API key not configured. Add openai_api_key to config.json.' };
                }
                const imgResponse = await openaiClient.images.generate({
                    model: 'dall-e-3',
                    prompt: input.prompt,
                    n: 1,
                    size: input.size || '1024x1024',
                    quality: input.quality || 'standard',
                    response_format: 'b64_json'
                });
                const imgData = imgResponse.data[0].b64_json;
                const imagesDir = path.join(WORKSPACE_PATH, 'outputs', 'images');
                await fs.mkdir(imagesDir, { recursive: true });
                const imgFilename = `image_${Date.now()}.png`;
                const outputPath = path.join(imagesDir, imgFilename);
                await fs.writeFile(outputPath, Buffer.from(imgData, 'base64'));
                return { success: true, path: outputPath, message: `Image generated: ${outputPath}`, revised_prompt: imgResponse.data[0].revised_prompt, send_photo: true, caption: input.prompt.substring(0, 200) };
            }

            case 'generate_chart': {
                const chartsDir = path.join(WORKSPACE_PATH, 'outputs', 'charts');
                await fs.mkdir(chartsDir, { recursive: true });
                const chartFilename = input.filename || `chart_${Date.now()}.png`;
                const outputPath = path.join(chartsDir, chartFilename);

                // Inject output_path and run the Python script
                const fullScript = `import matplotlib\nmatplotlib.use('Agg')\noutput_path = ${JSON.stringify(outputPath)}\n${input.python_code}`;
                const tmpScript = path.join(chartsDir, `_tmp_${Date.now()}.py`);
                await fs.writeFile(tmpScript, fullScript);

                let stdout = '';
                try {
                    const result = await execAsync(`python3 ${tmpScript}`, { timeout: 180000 });
                    stdout = result.stdout || '';
                    if (result.stderr) console.log('[PYTHON] stderr:', result.stderr.substring(0, 200));
                } finally {
                    await fs.unlink(tmpScript).catch(() => {});
                }

                // Check if a visual was produced
                let hasImage = false;
                try { await fs.access(outputPath); hasImage = true; } catch {}

                if (hasImage) {
                    return {
                        success: true,
                        path: outputPath,
                        caption: input.caption || '',
                        message: `Output generated: ${outputPath}`,
                        send_photo: true,
                        printed_output: stdout.substring(0, 10000) || undefined
                    };
                }
                // Text-only output (no image produced)
                return {
                    success: true,
                    message: stdout.substring(0, 10000) || 'Script completed with no output.',
                    printed_output: stdout.substring(0, 10000) || undefined
                };
            }

            case 'create_skill': {
                const skillDir = path.join(WORKSPACE_PATH, 'skills', input.name);
                await fs.mkdir(skillDir, { recursive: true });
                await fs.writeFile(path.join(skillDir, 'SKILL.md'), input.content);
                reindexRAG();
                return { success: true, message: `Skill '${input.name}' created` };
            }

            case 'update_dashboard': {
                return await postDashboard(input);
            }

            case 'send_file': {
                const filePath = input.path;
                await fs.access(filePath); // throws if not found
                const ext = path.extname(filePath).toLowerCase();
                const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
                const isImage = imageExts.includes(ext);
                return {
                    success: true,
                    send_photo: isImage,
                    send_document: !isImage,
                    path: filePath,
                    caption: input.caption || '',
                    message: `File queued for sending: ${filePath}`
                };
            }

            case 'send_voice_message': {
                if (!openaiClient) return { success: false, error: 'OpenAI not configured' };
                const speech = await openaiClient.audio.speech.create({
                    model: 'tts-1',
                    voice: 'onyx',
                    input: input.text,
                    response_format: 'opus',
                });
                const buffer = Buffer.from(await speech.arrayBuffer());
                const voicePath = path.join(WORKSPACE_PATH, `voice_${Date.now()}.ogg`);
                await fs.writeFile(voicePath, buffer);
                return { success: true, path: voicePath, send_voice: true, message: 'Voice message generated' };
            }

            case 'send_slack_message': {
                const { sendSlackMessage } = await import('./slack.js');
                const result = await sendSlackMessage(input.channel, input.message, input.thread_ts);
                return result;
            }

            case 'get_recent_uploads': {
                const { getUploadedFiles } = { getUploadedFiles: arguments[2]?.getUploadedFiles };
                if (!getUploadedFiles) {
                    return { success: true, uploads: [], note: 'Upload tracking not available' };
                }
                // Use owner chat ID as default — uploads come from the main chat
                const uploads = getUploadedFiles(config?.telegram_owner_id) || [];
                return { success: true, uploads, count: uploads.length };
            }

            case 'stock_quote': {
                const apiKey = config?.alphavantage_api_key;
                if (!apiKey) return { success: false, error: 'Alpha Vantage API key not configured.' };
                const data = await alphaVantageQuery({ function: 'GLOBAL_QUOTE', symbol: input.symbol }, apiKey);
                const q = data['Global Quote'];
                if (!q || !q['05. price']) return { success: false, error: `No quote data found for ${input.symbol}` };
                return {
                    success: true,
                    message: `${input.symbol.toUpperCase()}\nPrice: $${parseFloat(q['05. price']).toFixed(2)}\nChange: ${q['09. change']} (${q['10. change percent']})\nVolume: ${parseInt(q['06. volume']).toLocaleString()}\nPrevious Close: $${parseFloat(q['08. previous close']).toFixed(2)}\nLast Trading Day: ${q['07. latest trading day']}`
                };
            }

            case 'stock_search': {
                const apiKey = config?.alphavantage_api_key;
                if (!apiKey) return { success: false, error: 'Alpha Vantage API key not configured.' };
                const data = await alphaVantageQuery({ function: 'SYMBOL_SEARCH', keywords: input.keywords }, apiKey);
                const matches = data['bestMatches'] || [];
                if (matches.length === 0) return { success: true, message: `No matches found for "${input.keywords}"` };
                const results = matches.slice(0, 8).map(m =>
                    `${m['1. symbol']} — ${m['2. name']} (${m['4. region']}, ${m['3. type']})`
                ).join('\n');
                return { success: true, message: `Search results for "${input.keywords}":\n${results}` };
            }

            case 'company_overview': {
                const apiKey = config?.alphavantage_api_key;
                if (!apiKey) return { success: false, error: 'Alpha Vantage API key not configured.' };
                const d = await alphaVantageQuery({ function: 'OVERVIEW', symbol: input.symbol }, apiKey);
                if (!d.Symbol) return { success: false, error: `No data found for ${input.symbol}` };
                return {
                    success: true,
                    message: `${d.Name} (${d.Symbol}) — ${d.Exchange}\nSector: ${d.Sector} | Industry: ${d.Industry}\nMarket Cap: $${(parseInt(d.MarketCapitalization) / 1e9).toFixed(2)}B\nP/E Ratio: ${d.PERatio} | EPS: $${d.EPS}\nDividend Yield: ${d.DividendYield || 'N/A'}\n52-Week Range: $${d['52WeekLow']} – $${d['52WeekHigh']}\nAnalyst Target: $${d.AnalystTargetPrice}\nProfit Margin: ${d.ProfitMargin} | Revenue TTM: $${(parseInt(d.RevenueTTM) / 1e9).toFixed(2)}B\n\nDescription: ${(d.Description || '').substring(0, 500)}`
                };
            }

            case 'market_news': {
                const apiKey = config?.alphavantage_api_key;
                if (!apiKey) return { success: false, error: 'Alpha Vantage API key not configured.' };
                const params = { function: 'NEWS_SENTIMENT', limit: '10' };
                if (input.tickers) params.tickers = input.tickers;
                if (input.topics) params.topics = input.topics;
                const data = await alphaVantageQuery(params, apiKey);
                const feed = data.feed || [];
                if (feed.length === 0) return { success: true, message: 'No news articles found.' };
                const articles = feed.slice(0, 8).map(a =>
                    `• ${a.title}\n  Source: ${a.source} | ${a.time_published?.substring(0, 8) || ''}\n  Sentiment: ${a.overall_sentiment_label || 'N/A'}\n  ${a.summary?.substring(0, 150) || ''}`
                ).join('\n\n');
                return { success: true, message: `Market News:\n\n${articles}` };
            }

            case 'crypto_rate': {
                const apiKey = config?.alphavantage_api_key;
                if (!apiKey) return { success: false, error: 'Alpha Vantage API key not configured.' };
                const market = input.market || 'USD';
                const data = await alphaVantageQuery({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: input.symbol, to_currency: market }, apiKey);
                const r = data['Realtime Currency Exchange Rate'];
                if (!r) return { success: false, error: `No exchange rate data for ${input.symbol}/${market}` };
                return {
                    success: true,
                    message: `${r['2. From_Currency Name']} (${input.symbol.toUpperCase()}) → ${market}\nRate: ${parseFloat(r['5. Exchange Rate']).toFixed(4)}\nBid: ${r['8. Bid Price']} | Ask: ${r['9. Ask Price']}\nLast Updated: ${r['6. Last Refreshed']}`
                };
            }

            case 'economic_indicator': {
                const apiKey = config?.alphavantage_api_key;
                if (!apiKey) return { success: false, error: 'Alpha Vantage API key not configured.' };
                const data = await alphaVantageQuery({ function: input.function }, apiKey);
                const points = data.data || [];
                if (points.length === 0) return { success: false, error: `No data for ${input.function}` };
                const recent = points.slice(0, 8);
                const name = data.name || input.function;
                const unit = data.unit || '';
                const lines = recent.map(p => `${p.date}: ${p.value}${unit ? ' ' + unit : ''}`).join('\n');
                return { success: true, message: `${name}\nInterval: ${data.interval || 'N/A'}\n\nRecent data:\n${lines}` };
            }

            case 'confirm_delete': {
                const DELETE_PASSWORD = 'Navadaonline2026!';
                if (input.password !== DELETE_PASSWORD) {
                    return { success: false, error: 'Incorrect delete password. Deletion blocked. Ask the user to provide the correct password.' };
                }
                const deleteOptions = {
                    cwd: os.homedir(),
                    timeout: 60000,
                    maxBuffer: 10 * 1024 * 1024
                };
                const { stdout, stderr } = await execAsync(input.command, deleteOptions);
                console.log(`[GUARDRAIL] Delete executed after password verification: ${input.command}`);
                return { success: true, stdout, stderr, note: 'Delete command executed after password verification.' };
            }

            case 'calendar_list_events': {
                const { listEvents } = await import('./google-calendar.js');
                const events = await listEvents(config, {
                    maxResults: input.max_results,
                    timeMin: input.time_min,
                    timeMax: input.time_max,
                });
                if (events.length === 0) return { success: true, message: 'No upcoming events found.' };
                const lines = events.map(e =>
                    `• ${e.summary || '(No title)'}\n  ${e.start} → ${e.end}${e.location ? `\n  📍 ${e.location}` : ''}${e.attendees.length ? `\n  👥 ${e.attendees.join(', ')}` : ''}\n  ID: ${e.id}`
                ).join('\n\n');
                return { success: true, message: `Upcoming events (${events.length}):\n\n${lines}` };
            }

            case 'calendar_create_event': {
                const { createEvent } = await import('./google-calendar.js');
                const event = await createEvent(config, {
                    summary: input.summary,
                    description: input.description,
                    startTime: input.start_time,
                    endTime: input.end_time,
                    location: input.location,
                    attendees: input.attendees,
                });
                return { success: true, message: `Event created: ${event.summary}\n${event.start} → ${event.end}\nID: ${event.id}${event.htmlLink ? `\nLink: ${event.htmlLink}` : ''}` };
            }

            case 'calendar_update_event': {
                const { updateEvent } = await import('./google-calendar.js');
                const event = await updateEvent(config, {
                    eventId: input.event_id,
                    summary: input.summary,
                    description: input.description,
                    startTime: input.start_time,
                    endTime: input.end_time,
                    location: input.location,
                });
                return { success: true, message: `Event updated: ${event.summary}\n${event.start} → ${event.end}\nID: ${event.id}` };
            }

            case 'calendar_delete_event': {
                const { deleteEvent } = await import('./google-calendar.js');
                await deleteEvent(config, { eventId: input.event_id });
                return { success: true, message: `Event ${input.event_id} deleted.` };
            }

            case 'linkedin_post': {
                const { createPost } = await import('./linkedin.js');
                if (input.text && input.text.length > 3000) {
                    return { success: false, error: 'Post text exceeds 3000 character limit.' };
                }
                return await createPost({ text: input.text, linkUrl: input.link_url, imagePath: input.image_path }, config);
            }

            case 'fetch_url': {
                const fetchModule = await import('node:https');
                const httpModule = await import('node:http');
                const urlObj = new URL(input.url);
                const lib = urlObj.protocol === 'https:' ? fetchModule.default : httpModule.default;
                const method = input.method || 'GET';
                const headers = input.headers || {};
                if (!headers['User-Agent']) headers['User-Agent'] = 'ALEX/1.0';

                const body = await new Promise((resolve, reject) => {
                    const req = lib.request(input.url, { method, headers, timeout: 30000 }, (res) => {
                        // Follow redirects
                        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                            resolve({ redirect: res.headers.location });
                            return;
                        }
                        let data = '';
                        res.on('data', chunk => {
                            data += chunk;
                            if (data.length > 50000) { res.destroy(); }
                        });
                        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
                        res.on('error', reject);
                    });
                    req.on('error', reject);
                    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
                    if (input.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
                        req.write(input.body);
                    }
                    req.end();
                });

                if (body.redirect) {
                    return { success: true, redirect: body.redirect, message: `Redirected to ${body.redirect} — fetch that URL to follow` };
                }
                return {
                    success: true,
                    status: body.status,
                    content_type: body.headers?.['content-type'] || '',
                    body: (body.body || '').substring(0, 50000),
                    note: (body.body || '').length > 50000 ? 'Truncated to 50,000 characters' : undefined
                };
            }


            case 'generate_diagram': {
                const diagramsDir = path.join(WORKSPACE_PATH, 'outputs', 'diagrams');
                await fs.mkdir(diagramsDir, { recursive: true });
                const mmdFilename = `diagram_${Date.now()}.mmd`;
                const mmdPath = path.join(diagramsDir, mmdFilename);
                const outFilename = input.filename || `diagram_${Date.now()}.png`;
                const outputPath = path.join(diagramsDir, outFilename);
                await fs.writeFile(mmdPath, input.mermaid_code);
                try {
                    await execAsync(`npx --yes @mermaid-js/mermaid-cli mmdc -i ${JSON.stringify(mmdPath)} -o ${JSON.stringify(outputPath)} -b transparent --puppeteerConfigFile /dev/null`, { timeout: 60000 });
                    await fs.unlink(mmdPath).catch(() => {});
                    return { success: true, path: outputPath, message: `Diagram generated: ${outputPath}`, send_photo: true, caption: 'Mermaid diagram' };
                } catch (err) {
                    await fs.unlink(mmdPath).catch(() => {});
                    return { success: false, error: `Mermaid rendering failed: ${err.message}` };
                }
            }

            case 'generate_mindmap': {
                const mindmapsDir = path.join(WORKSPACE_PATH, 'outputs', 'mindmaps');
                await fs.mkdir(mindmapsDir, { recursive: true });
                const mdFilename = `mindmap_${Date.now()}.md`;
                const mdPath = path.join(mindmapsDir, mdFilename);
                const htmlFilename = `mindmap_${Date.now()}.html`;
                const htmlPath = path.join(mindmapsDir, htmlFilename);
                const outFilename = input.filename || `mindmap_${Date.now()}.png`;
                const outputPath = path.join(mindmapsDir, outFilename);
                await fs.writeFile(mdPath, input.markdown);
                try {
                    // Generate HTML with markmap-cli
                    await execAsync(`npx --yes markmap-cli ${JSON.stringify(mdPath)} -o ${JSON.stringify(htmlPath)} --no-open`, { timeout: 60000 });
                    // Screenshot HTML to PNG with puppeteer
                    const screenshotScript = `
                        const puppeteer = require('puppeteer');
                        (async () => {
                            const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                            const page = await browser.newPage();
                            await page.setViewport({ width: 1400, height: 1000 });
                            await page.goto('file://${htmlPath.replace(/'/g, "\\'")}', { waitUntil: 'networkidle0', timeout: 30000 });
                            await new Promise(r => setTimeout(r, 1500));
                            await page.screenshot({ path: '${outputPath.replace(/'/g, "\\'")}', fullPage: true });
                            await browser.close();
                        })();
                    `;
                    const tmpScript = path.join(mindmapsDir, `_ss_${Date.now()}.cjs`);
                    await fs.writeFile(tmpScript, screenshotScript);
                    await execAsync(`node ${JSON.stringify(tmpScript)}`, { timeout: 60000 });
                    await fs.unlink(tmpScript).catch(() => {});
                    await fs.unlink(mdPath).catch(() => {});
                    await fs.unlink(htmlPath).catch(() => {});
                    return { success: true, path: outputPath, message: `Mind map generated: ${outputPath}`, send_photo: true, caption: 'Mind map' };
                } catch (err) {
                    await fs.unlink(mdPath).catch(() => {});
                    await fs.unlink(htmlPath).catch(() => {});
                    return { success: false, error: `Mind map rendering failed: ${err.message}` };
                }
            }

            case 'generate_webapp': {
                const webappsDir = path.join(WORKSPACE_PATH, 'outputs', 'webapps');
                await fs.mkdir(webappsDir, { recursive: true });
                const outputPath = path.join(webappsDir, input.filename);
                await fs.writeFile(outputPath, input.html_code, 'utf-8');
                return {
                    success: true,
                    path: outputPath,
                    message: `Web app generated: ${outputPath}`,
                    send_document: true,
                    caption: input.caption || 'Web app ready — open in Chrome or Safari to view.'
                };
            }

            case 'manage_user': {
                const configPath = config._configPath || path.join(process.env.ALEX_CONFIG || path.join(os.homedir(), '.alex', 'config.json'));
                const rawConfig = JSON.parse(await fs.readFile(configPath, 'utf-8'));

                if (input.action === 'list') {
                    const users = rawConfig.telegram_authorized_users || [];
                    const fullAccess = [...FULL_ACCESS_USERS];
                    return {
                        success: true,
                        message: `Authorized users: ${users.length ? users.join(', ') : 'none'}\nFull access users: ${fullAccess.length ? fullAccess.join(', ') : 'none'}\nOwner: ${rawConfig.telegram_owner_id || 'not set'}`
                    };
                }

                if (!input.user_id) {
                    return { success: false, error: 'user_id is required for add/remove actions' };
                }

                const uid = input.user_id;
                if (!rawConfig.telegram_authorized_users) rawConfig.telegram_authorized_users = [];

                if (input.action === 'add') {
                    if (!rawConfig.telegram_authorized_users.includes(uid)) {
                        rawConfig.telegram_authorized_users.push(uid);
                    }
                    if (input.full_access) {
                        FULL_ACCESS_USERS.add(uid);
                        if (!rawConfig.full_access_users) rawConfig.full_access_users = [];
                        if (!rawConfig.full_access_users.includes(uid)) rawConfig.full_access_users.push(uid);
                    }
                    // Update in-memory config
                    config.telegram_authorized_users = rawConfig.telegram_authorized_users;
                    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2));
                    return { success: true, message: `User ${uid} added${input.full_access ? ' with full access' : ''}` };
                }

                if (input.action === 'remove') {
                    rawConfig.telegram_authorized_users = rawConfig.telegram_authorized_users.filter(id => id !== uid);
                    FULL_ACCESS_USERS.delete(uid);
                    if (rawConfig.full_access_users) {
                        rawConfig.full_access_users = rawConfig.full_access_users.filter(id => id !== uid);
                    }
                    config.telegram_authorized_users = rawConfig.telegram_authorized_users;
                    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2));
                    return { success: true, message: `User ${uid} removed` };
                }

                return { success: false, error: `Unknown action: ${input.action}` };
            }

            case 'tiktok_scrape': {
                const apiKey = config?.apify_api_key;
                if (!apiKey) return { success: false, error: 'Apify API key not configured.' };

                const actorInput = { resultsPerPage: Math.min(input.resultsPerPage || 20, 100) };
                if (input.hashtags?.length) actorInput.hashtags = input.hashtags;
                if (input.profiles?.length) actorInput.profiles = input.profiles;
                if (input.searchQueries?.length) actorInput.searchQueries = input.searchQueries;
                if (input.videoUrls?.length) actorInput.videoUrls = input.videoUrls;

                // Default to #fyp if nothing specified
                if (!actorInput.hashtags && !actorInput.profiles && !actorInput.searchQueries && !actorInput.videoUrls) {
                    actorInput.hashtags = ['fyp'];
                }

                try {
                    const videos = await apifyRunActor('clockworks~tiktok-scraper', actorInput, apiKey, 180000);

                    if (!Array.isArray(videos) || videos.length === 0) {
                        return { success: true, message: 'No videos found.', videos: [] };
                    }

                    const formatted = videos.slice(0, 50).map((v, i) => ({
                        index: i + 1,
                        author: v.authorMeta?.name || v.author || 'unknown',
                        description: (v.text || '').substring(0, 200),
                        views: v.playCount || 0,
                        likes: v.diggCount || 0,
                        comments: v.commentCount || 0,
                        shares: v.shareCount || 0,
                        url: v.webVideoUrl || `https://tiktok.com/@${v.authorMeta?.id}/video/${v.id}`,
                        hashtags: (v.hashtags || []).map(h => h.name || h).slice(0, 5),
                    }));

                    const totalViews = formatted.reduce((sum, v) => sum + v.views, 0);
                    return {
                        success: true,
                        message: `Scraped ${videos.length} videos. Total views: ${totalViews.toLocaleString()}`,
                        count: videos.length,
                        videos: formatted,
                    };
                } catch (err) {
                    return { success: false, error: `TikTok scrape failed: ${err.message}` };
                }
            }

            case 'tiktok_download': {
                const videosDir = path.join(WORKSPACE_PATH, 'outputs', 'tiktok');
                await fs.mkdir(videosDir, { recursive: true });
                const filename = `tiktok_${Date.now()}.mp4`;
                const outputPath = path.join(videosDir, filename);

                try {
                    // Use tikwm.com API to get video download URL (free, no watermark)
                    const apiRes = await fetch('https://www.tikwm.com/api/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: 'url=' + encodeURIComponent(input.url),
                    });

                    const apiData = await apiRes.json();

                    if (apiData.code !== 0 || !apiData.data) {
                        return { success: false, error: `Could not fetch video info: ${apiData.msg || 'unknown error'}` };
                    }

                    const videoUrl = apiData.data.hdplay || apiData.data.play;
                    const author = apiData.data.author?.nickname || apiData.data.author?.unique_id || 'unknown';

                    if (!videoUrl) {
                        return { success: false, error: 'No download URL found for this video.' };
                    }

                    // Download the video file
                    const videoRes = await fetch(videoUrl, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    });

                    if (!videoRes.ok) {
                        return { success: false, error: `Failed to download video: HTTP ${videoRes.status}` };
                    }

                    const buffer = Buffer.from(await videoRes.arrayBuffer());

                    // Check file size (Telegram limit is 50MB for bots)
                    if (buffer.length > 50 * 1024 * 1024) {
                        return { success: false, error: 'Video too large for Telegram (>50MB). Try a shorter video.' };
                    }

                    await fs.writeFile(outputPath, buffer);

                    return {
                        success: true,
                        path: outputPath,
                        message: `Video downloaded: ${filename} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`,
                        send_document: true,
                        caption: input.caption || `TikTok: @${author}`
                    };
                } catch (err) {
                    return { success: false, error: `TikTok download failed: ${err.message}` };
                }
            }

            case 'linkedin_posts_search': {
                const apiKey = config?.apify_api_key;
                if (!apiKey) return { success: false, error: 'Apify API key not configured.' };

                const actorInput = {
                    searchKeyword: input.searchKeyword,
                    sortType: input.sortType || 'Relevance',
                    pageNumber: input.pageNumber || 1,
                    resultLimit: Math.min(input.resultLimit || 50, 100),
                };
                if (input.dateFilter) actorInput.dateFilter = input.dateFilter;

                try {
                    const posts = await apifyRunActor('apimaestro~linkedin-posts-search-scraper-no-cookies', actorInput, apiKey, 180000);

                    if (!Array.isArray(posts) || posts.length === 0) {
                        return { success: true, message: 'No posts found.', posts: [] };
                    }

                    const formatted = posts.slice(0, 50).map((p, i) => ({
                        index: i + 1,
                        author: p.authorName || p.author?.name || 'unknown',
                        authorHeadline: p.authorHeadline || p.author?.headline || '',
                        authorProfileUrl: p.authorProfileUrl || p.author?.url || '',
                        content: (p.text || p.content || '').substring(0, 500),
                        reactions: p.totalReactionCount || p.reactions || 0,
                        comments: p.commentsCount || p.comments || 0,
                        reposts: p.repostsCount || p.reposts || 0,
                        postUrl: p.postUrl || p.url || '',
                        postedAt: p.postedAt || p.timestamp || '',
                        hasMedia: !!(p.images?.length || p.video),
                    }));

                    const totalReactions = formatted.reduce((sum, p) => sum + p.reactions, 0);
                    return {
                        success: true,
                        message: `Found ${posts.length} LinkedIn posts. Total reactions: ${totalReactions.toLocaleString()}`,
                        count: posts.length,
                        posts: formatted,
                    };
                } catch (err) {
                    return { success: false, error: `LinkedIn search failed: ${err.message}` };
                }
            }

            case 'indeed_job_search': {
                const apiKey = config?.apify_api_key;
                if (!apiKey) return { success: false, error: 'Apify API key not configured.' };

                const actorInput = {
                    position: input.position,
                    country: input.country || 'United Kingdom',
                    maxItems: Math.min(input.maxItems || 100, 200),
                    saveOnlyUniqueJobs: input.saveOnlyUniqueJobs !== false,
                    scrapeCompanyDetails: input.scrapeCompanyDetails || false,
                    followApplyRedirects: false,
                };
                if (input.location) actorInput.location = input.location;

                try {
                    const jobs = await apifyRunActor('misceres~indeed-scraper', actorInput, apiKey, 180000);

                    if (!Array.isArray(jobs) || jobs.length === 0) {
                        return { success: true, message: 'No jobs found.', jobs: [] };
                    }

                    const formatted = jobs.slice(0, 100).map((j, i) => ({
                        index: i + 1,
                        title: j.positionName || j.title || 'Unknown Position',
                        company: j.company || 'Unknown Company',
                        location: j.location || '',
                        salary: j.salary || 'Not specified',
                        rating: j.rating || null,
                        reviewsCount: j.reviewsCount || 0,
                        jobUrl: j.url || j.externalApplyLink || '',
                        description: (j.description || '').substring(0, 300),
                        postedAt: j.postedAt || '',
                    }));

                    return {
                        success: true,
                        message: `Found ${jobs.length} jobs for "${input.position}"${input.location ? ` in ${input.location}` : ''}.`,
                        count: jobs.length,
                        jobs: formatted,
                    };
                } catch (err) {
                    return { success: false, error: `Indeed search failed: ${err.message}` };
                }
            }

            case 'google_maps_leads': {
                const apiKey = config?.apify_api_key;
                if (!apiKey) return { success: false, error: 'Apify API key not configured.' };

                const actorInput = {
                    searchStringsArray: input.searchTerms,
                    locationQuery: input.location,
                    maxCrawledPlacesPerSearch: Math.min(input.maxResults || 20, 100),
                    scrapeContacts: input.scrapeContacts !== false,
                    maxLeads: Math.min(input.maxLeadsPerPlace || 3, 10),
                    leadsDepartments: input.leadsDepartments || ['C-Suite', 'Engineering & Technical', 'Information Technology'],
                };

                try {
                    const places = await apifyRunActor('compass~crawler-google-places', actorInput, apiKey, 300000);

                    if (!Array.isArray(places) || places.length === 0) {
                        return { success: true, message: 'No businesses found.', places: [] };
                    }

                    const formatted = places.slice(0, 50).map((p, i) => ({
                        index: i + 1,
                        name: p.title || p.name || 'Unknown Business',
                        address: p.address || '',
                        phone: p.phone || p.phoneUnformatted || '',
                        website: p.website || '',
                        email: p.email || '',
                        rating: p.totalScore || p.rating || null,
                        reviewsCount: p.reviewsCount || 0,
                        category: p.categoryName || p.category || '',
                        placeUrl: p.url || '',
                        leads: (p.leads || []).slice(0, 5).map(l => ({
                            name: l.fullName || l.name || '',
                            title: l.jobTitle || l.title || '',
                            email: l.workEmail || l.email || '',
                            phone: l.phone || '',
                            linkedin: l.linkedInUrl || l.linkedin || '',
                        })),
                    }));

                    const totalLeads = formatted.reduce((sum, p) => sum + (p.leads?.length || 0), 0);
                    return {
                        success: true,
                        message: `Found ${places.length} businesses with ${totalLeads} leads for "${input.searchTerms.join(', ')}" in ${input.location}.`,
                        count: places.length,
                        totalLeads,
                        places: formatted,
                    };
                } catch (err) {
                    return { success: false, error: `Google Maps lead search failed: ${err.message}` };
                }
            }

            case 'glassdoor_scrape': {
                const apiKey = config?.apify_api_key;
                if (!apiKey) return { success: false, error: 'Apify API key not configured.' };

                const actorInput = {
                    scrapeReviews: input.scrapeReviews !== false,
                    scrapeInterviews: input.scrapeInterviews !== false,
                    scrapeSalaries: input.scrapeSalaries !== false,
                    scrapeBenefits: input.scrapeBenefits !== false,
                };

                if (input.startUrls?.length) {
                    actorInput.startUrls = input.startUrls.map(url => ({ url }));
                }
                if (input.searchQuery) {
                    actorInput.searchQuery = input.searchQuery;
                }

                try {
                    const results = await apifyRunActor('memo23~glassdoor-scraper-ppe', actorInput, apiKey, 180000);

                    if (!Array.isArray(results) || results.length === 0) {
                        return { success: true, message: 'No results found.', data: [] };
                    }

                    const maxItems = Math.min(input.maxItems || 50, 100);
                    const formatted = results.slice(0, maxItems).map((r, i) => ({
                        index: i + 1,
                        company: r.companyName || r.name || 'Unknown',
                        rating: r.overallRating || r.rating || null,
                        reviewsCount: r.numberOfReviews || 0,
                        salaryCount: r.numberOfSalaries || 0,
                        interviewsCount: r.numberOfInterviews || 0,
                        recommendToFriend: r.recommendToFriend || null,
                        ceoApproval: r.ceoApproval || null,
                        reviews: (r.reviews || []).slice(0, 3).map(rev => ({
                            title: rev.title || rev.headline || '',
                            rating: rev.rating || rev.overallRating || null,
                            pros: (rev.pros || '').substring(0, 200),
                            cons: (rev.cons || '').substring(0, 200),
                            role: rev.jobTitle || rev.role || '',
                        })),
                        salaries: (r.salaries || []).slice(0, 5).map(sal => ({
                            jobTitle: sal.jobTitle || sal.title || '',
                            salary: sal.salary || sal.basePay || sal.totalPay || '',
                            currency: sal.currency || '',
                        })),
                        interviews: (r.interviews || []).slice(0, 3).map(int => ({
                            jobTitle: int.jobTitle || int.title || '',
                            difficulty: int.difficulty || '',
                            experience: int.experience || '',
                            offer: int.offer || int.gotOffer || '',
                        })),
                    }));

                    return {
                        success: true,
                        message: `Scraped ${results.length} Glassdoor entries.`,
                        count: results.length,
                        data: formatted,
                    };
                } catch (err) {
                    return { success: false, error: `Glassdoor scrape failed: ${err.message}` };
                }
            }

            case 'linkedin_profile_scrape': {
                const apiKey = config?.apify_api_key;
                if (!apiKey) return { success: false, error: 'Apify API key not configured.' };

                // Normalize profile inputs to URLs
                const profileUrls = input.profiles.map(p => {
                    if (p.startsWith('http')) return p;
                    return `https://www.linkedin.com/in/${p.replace(/^@/, '')}`;
                });

                const actorInput = {
                    profileUrls,
                    searchForEmail: input.searchForEmail !== false,
                };

                try {
                    const profiles = await apifyRunActor('GOvL4O4RwFqsdIqXF', actorInput, apiKey, 180000);

                    if (!Array.isArray(profiles) || profiles.length === 0) {
                        return { success: true, message: 'No profiles found.', profiles: [] };
                    }

                    const formatted = profiles.slice(0, 50).map((p, i) => ({
                        index: i + 1,
                        name: p.fullName || p.name || 'Unknown',
                        headline: p.headline || '',
                        location: p.location || p.geoLocation || '',
                        profileUrl: p.profileUrl || p.url || '',
                        email: p.email || p.emails?.[0] || '',
                        phone: p.phone || '',
                        currentCompany: p.currentCompany || p.experience?.[0]?.company || '',
                        currentTitle: p.currentTitle || p.experience?.[0]?.title || '',
                        summary: (p.summary || p.about || '').substring(0, 300),
                        experience: (p.experience || []).slice(0, 3).map(e => ({
                            title: e.title || '',
                            company: e.company || e.companyName || '',
                            duration: e.duration || '',
                        })),
                        education: (p.education || []).slice(0, 2).map(e => ({
                            school: e.school || e.schoolName || '',
                            degree: e.degree || '',
                            field: e.field || e.fieldOfStudy || '',
                        })),
                        certifications: (p.certifications || []).slice(0, 3).map(c => c.name || c),
                    }));

                    const emailCount = formatted.filter(p => p.email).length;
                    return {
                        success: true,
                        message: `Scraped ${profiles.length} LinkedIn profiles. Found ${emailCount} email addresses.`,
                        count: profiles.length,
                        emailsFound: emailCount,
                        profiles: formatted,
                    };
                } catch (err) {
                    return { success: false, error: `LinkedIn profile scrape failed: ${err.message}` };
                }
            }

            default:
                return { success: false, error: `Unknown tool: ${name}` };
        }
        }; // end executeSwitch

        return needsOuterTimeout ? await withTimeout(name, executeSwitch()) : await executeSwitch();
    } catch (error) {
        return { success: false, error: error.message, stderr: error.stderr };
    }
}
