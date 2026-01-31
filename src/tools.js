/**
 * Tool definitions and execution
 */

import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import nodemailer from 'nodemailer';
import http from 'http';
import { WORKSPACE_PATH, ALLOWED_WRITE_PATHS, ALLOWED_ATTACHMENT_PATHS, isPathAllowed } from './config.js';

const DASHBOARD_API = 'http://127.0.0.1:8080/api/update';

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
        const scriptPath = path.join(WORKSPACE_PATH, 'scripts/rag_manager.py');
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
    try {
        const scriptPath = path.join(WORKSPACE_PATH, 'scripts/rag_manager.py');
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
    } catch (err) {
        console.error('[RAG] Query error:', err.message);
    }
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
// DASHBOARD API HELPER
// ============================================================================

async function postDashboard(payload) {
    return new Promise((resolve) => {
        const body = JSON.stringify(payload);
        const req = http.request(DASHBOARD_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            timeout: 5000,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok) {
                        resolve({ success: true, message: `Dashboard updated (${payload.action})` });
                    } else {
                        resolve({ success: false, error: parsed.error || 'Unknown error' });
                    }
                } catch {
                    resolve({ success: false, error: `Bad response: ${data.substring(0, 200)}` });
                }
            });
        });
        req.on('error', (err) => {
            resolve({ success: false, error: `Dashboard unreachable: ${err.message}` });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, error: 'Dashboard request timed out' });
        });
        req.write(body);
        req.end();
    });
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
                timeout: { type: "number", description: "Timeout in milliseconds (default: 60000)" }
            },
            required: ["command"]
        }
    },
    {
        name: "read_file",
        description: "Read the contents of a file",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file (creates directories if needed). Restricted to workspace (~/.alex/) and /tmp.",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file (must be within ~/.alex/ or /tmp)" },
                content: { type: "string", description: "Content to write" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "list_directory",
        description: "List contents of a directory",
        input_schema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the directory" }
            },
            required: ["path"]
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
        description: "Compose and send a professional email. ALWAYS write the body in well-structured HTML with proper tags (<h2>, <p>, <ul>, <li>, <br>, <strong>). Include spacing between sections. Auto-CCs configured address. Supports attachments.",
        input_schema: {
            type: "object",
            properties: {
                to: { type: "string", description: "Recipient email address" },
                subject: { type: "string", description: "Email subject" },
                body: { type: "string", description: "Email body in HTML format. Use <h2> for headings, <p> for paragraphs, <ul>/<li> for lists, <strong> for emphasis. Must be properly structured and professional." },
                attachment_path: { type: "string", description: "Optional absolute path to a file to attach (must be within workspace)" },
                attachment_filename: { type: "string", description: "Optional filename for the attachment (defaults to basename of path)" }
            },
            required: ["to", "subject", "body"]
        }
    },
    {
        name: "generate_pdf",
        description: "Generate a styled PDF report. Provide structured data (title, subtitle, sections with headings/content/tables, footer). Returns the file path of the generated PDF.",
        input_schema: {
            type: "object",
            properties: {
                title: { type: "string", description: "Report title" },
                subtitle: { type: "string", description: "Optional subtitle" },
                sections: {
                    type: "array",
                    description: "Array of sections, each with optional heading, content, and table",
                    items: {
                        type: "object",
                        properties: {
                            heading: { type: "string" },
                            content: { type: "string" },
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
        description: "Generate a chart or graph using Python (matplotlib/seaborn/numpy/pandas/scipy/scikit-learn). Write a complete Python script that saves a PNG image. The script has access to: numpy, pandas, matplotlib, seaborn, scipy, scikit-learn. Always save the output to the specified output_path. Use plt.savefig() with dpi=150 and bbox_inches='tight'. Use a clean professional style.",
        input_schema: {
            type: "object",
            properties: {
                python_code: { type: "string", description: "Complete Python script that generates and saves a chart. Must use plt.savefig(output_path, dpi=150, bbox_inches='tight'). Use the variable 'output_path' which will be injected." },
                filename: { type: "string", description: "Output filename (e.g. 'nvidia_revenue.png'). Saved to ~/.alex/charts/" },
                caption: { type: "string", description: "Caption to display with the chart" }
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
        description: "Update the NAVADA activity dashboard at 192.168.0.45:8080. Use this to log tasks, post news/insights, update metrics, log activity, or update service status. Actions: add_task, update_task, update_metrics, add_news, add_activity, update_services, set_status.",
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
    }
];

// ============================================================================
// TOOL EXECUTION
// ============================================================================

export async function executeTool(name, input, { memory, skills, config, scheduledTasks, handleScheduledTask, openaiClient, cron }) {
    console.log(`[TOOL] Executing: ${name}`, JSON.stringify(input).substring(0, 200));

    try {
        switch (name) {
            case 'bash': {
                const options = {
                    cwd: input.working_directory || os.homedir(),
                    timeout: input.timeout || 60000,
                    maxBuffer: 10 * 1024 * 1024
                };
                const { stdout, stderr } = await execAsync(input.command, options);
                return { success: true, stdout, stderr };
            }

            case 'read_file': {
                const content = await fs.readFile(input.path, 'utf-8');
                return { success: true, content };
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

                // Ensure the body is proper HTML — if Alex sends raw text, wrap it
                let emailBody = input.body || 'No content';
                if (!emailBody.includes('<') || !emailBody.includes('>')) {
                    // Plain text — convert to styled HTML
                    emailBody = emailBody
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')
                        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
                        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
                        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
                        .replace(/^[-—] (.*$)/gm, '<li>$1</li>')
                        .replace(/\n\n/g, '</p><p>')
                        .replace(/\n/g, '<br>');
                    emailBody = `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.7; color: #1a1a1a; max-width: 680px; margin: 0 auto; padding: 20px;">
                        <p>${emailBody}</p>
                        <br>
                        <p style="color: #555; font-size: 13px; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 24px;">
                            ALEX — Global Economist, NAVADA VC
                        </p>
                    </div>`;
                } else if (!emailBody.includes('font-family')) {
                    // Has HTML tags but no styling — wrap in styled container
                    emailBody = `<div style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; line-height: 1.7; color: #1a1a1a; max-width: 680px; margin: 0 auto; padding: 20px;">
                        ${emailBody}
                        <br>
                        <p style="color: #555; font-size: 13px; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 24px;">
                            ALEX — Global Economist, NAVADA VC
                        </p>
                    </div>`;
                }

                const mailOptions = {
                    from: `"ALEX — NAVADA VC" <${config.gmail_address}>`,
                    to: input.to || config.recipient_email,
                    cc: ccEmail,
                    subject: input.subject || 'Message from ALEX',
                    html: emailBody
                };
                if (input.attachment_path) {
                    mailOptions.attachments = [{
                        filename: input.attachment_filename || path.basename(input.attachment_path),
                        path: input.attachment_path
                    }];
                }
                await transporter.sendMail(mailOptions);
                return { success: true, message: `Email sent to ${input.to || config.recipient_email} (CC: ${ccEmail})${input.attachment_path ? ' with attachment' : ''}` };
            }

            case 'generate_pdf': {
                const timestamp = Date.now();
                const filename = input.filename || `report_${timestamp}.pdf`;
                const reportsDir = path.join(WORKSPACE_PATH, 'reports');
                await fs.mkdir(reportsDir, { recursive: true });
                const outputPath = path.join(reportsDir, filename);

                const tmpJson = path.join(reportsDir, `_tmp_${timestamp}.json`);
                const pdfData = {
                    title: input.title,
                    subtitle: input.subtitle || '',
                    sections: input.sections || [],
                    footer: input.footer || 'NAVADA VC — Confidential'
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
                const taskFile = path.join(WORKSPACE_PATH, 'tasks', `${input.name}.json`);
                await fs.mkdir(path.dirname(taskFile), { recursive: true });
                await fs.writeFile(taskFile, JSON.stringify(input, null, 2));

                if (scheduledTasks.has(input.name)) {
                    scheduledTasks.get(input.name).stop();
                }

                const job = cron.schedule(input.cron_expression, async () => {
                    console.log(`[CRON] Running scheduled task: ${input.name}`);
                    await handleScheduledTask(input);
                });

                scheduledTasks.set(input.name, job);
                return { success: true, message: `Task '${input.name}' scheduled with cron: ${input.cron_expression}` };
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
                const imagesDir = path.join(WORKSPACE_PATH, 'images');
                await fs.mkdir(imagesDir, { recursive: true });
                const imgFilename = `image_${Date.now()}.png`;
                const outputPath = path.join(imagesDir, imgFilename);
                await fs.writeFile(outputPath, Buffer.from(imgData, 'base64'));
                return { success: true, path: outputPath, message: `Image generated: ${outputPath}`, revised_prompt: imgResponse.data[0].revised_prompt };
            }

            case 'generate_chart': {
                const chartsDir = path.join(WORKSPACE_PATH, 'charts');
                await fs.mkdir(chartsDir, { recursive: true });
                const chartFilename = input.filename || `chart_${Date.now()}.png`;
                const outputPath = path.join(chartsDir, chartFilename);

                // Inject output_path and run the Python script
                const fullScript = `import matplotlib\nmatplotlib.use('Agg')\noutput_path = ${JSON.stringify(outputPath)}\n${input.python_code}`;
                const tmpScript = path.join(chartsDir, `_tmp_${Date.now()}.py`);
                await fs.writeFile(tmpScript, fullScript);

                try {
                    const { stderr } = await execAsync(`python3 ${tmpScript}`, { timeout: 60000 });
                    if (stderr) console.log('[CHART] stderr:', stderr.substring(0, 200));
                } finally {
                    await fs.unlink(tmpScript).catch(() => {});
                }

                // Verify the file was created
                await fs.access(outputPath);
                return {
                    success: true,
                    path: outputPath,
                    caption: input.caption || '',
                    message: `Chart generated: ${outputPath}`,
                    send_photo: true
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

            default:
                return { success: false, error: `Unknown tool: ${name}` };
        }
    } catch (error) {
        return { success: false, error: error.message, stderr: error.stderr };
    }
}
