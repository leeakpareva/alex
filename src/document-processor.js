/**
 * Document Processor — Extracts text from uploaded files and indexes into ChromaDB.
 * Supports: PDF (text + OCR), DOCX, images (OCR), plain text, markdown.
 * Splits at LESLIE/manager-notes markers for permanent indexing.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const RAG_SCRIPT = path.join(__dirname, '..', 'scripts', 'rag_manager.py');

// Supported file extensions
const SUPPORTED = new Set(['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.bmp', '.tiff', '.tif', '.txt', '.md']);

// LESLIE / Manager notes marker patterns (case-insensitive)
const MANAGER_PATTERNS = [
    /leslie\s*[\(\-\u2013\u2014:]\s*manager\s*[\)\-\u2013\u2014:]?\s*notes?/i,
    /manager\s*[\(\-\u2013\u2014:]\s*leslie\s*[\)\-\u2013\u2014:]?\s*notes?/i,
    /leslie\s*['\u2019]?s?\s*notes?/i,
    /manager\s*notes?/i,
];

/**
 * Main entry point: process an uploaded file end-to-end.
 * @param {string} filePath - Absolute path to the uploaded file
 * @returns {{ ok: boolean, chunks?: number, source?: string, error?: string }}
 */
export async function processUploadedFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const basename = path.basename(filePath);

    if (!SUPPORTED.has(ext)) {
        console.log(`[UPLOAD] Skipping unsupported file type: ${basename}`);
        return { ok: false, error: `Unsupported file type: ${ext}` };
    }

    console.log(`[UPLOAD] Processing: ${basename}`);

    try {
        // Step 1: Extract text
        const text = await extractText(filePath, ext);
        if (!text || text.trim().length < 50) {
            console.log(`[UPLOAD] Insufficient text extracted from ${basename} (${text?.length || 0} chars)`);
            return { ok: false, error: 'Insufficient text extracted' };
        }

        console.log(`[UPLOAD] Extracted ${text.length} chars from ${basename}`);

        // Step 2: Split at LESLIE marker
        const { general, permanent } = splitAtManagerMarker(text);

        let totalChunks = 0;

        // Step 3: Index general content (5-day TTL)
        if (general.trim().length >= 50) {
            const result = await indexText(general, basename, 5, false);
            totalChunks += result.chunks || 0;
        }

        // Step 4: Index permanent content (no expiry)
        if (permanent.trim().length >= 50) {
            const result = await indexText(permanent, `${basename}:permanent`, 0, true);
            totalChunks += result.chunks || 0;
            console.log(`[UPLOAD] Permanent notes indexed from ${basename}`);
        }

        console.log(`[UPLOAD] Done: ${basename} → ${totalChunks} chunks indexed`);
        return { ok: true, chunks: totalChunks, source: basename };
    } catch (err) {
        console.error(`[UPLOAD] Failed to process ${basename}:`, err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Route to the correct text extractor based on file extension.
 */
async function extractText(filePath, ext) {
    switch (ext) {
        case '.pdf':
            return extractPdfText(filePath);
        case '.docx':
            return extractDocxText(filePath);
        case '.xlsx':
            return extractXlsxText(filePath);
        case '.png': case '.jpg': case '.jpeg': case '.bmp': case '.tiff': case '.tif':
            return extractImageText(filePath);
        case '.txt': case '.md':
            return fs.readFile(filePath, 'utf-8');
        default:
            return null;
    }
}

/**
 * Extract text from PDF. Try pdftotext first; if <50 chars, fall back to OCR.
 */
async function extractPdfText(filePath) {
    try {
        const { stdout } = await execAsync(`pdftotext -layout "${filePath}" -`, {
            timeout: 30000,
            maxBuffer: 10 * 1024 * 1024,
        });
        if (stdout.trim().length >= 50) {
            return stdout;
        }
    } catch {
        // pdftotext failed, try OCR
    }

    // Fallback: OCR via pdf2image + pytesseract
    console.log(`[UPLOAD] PDF text too short, attempting OCR...`);
    try {
        const { stdout } = await execAsync(`python3 -c "
import sys
from pdf2image import convert_from_path
import pytesseract
pages = convert_from_path('${filePath.replace(/'/g, "\\'")}', dpi=200)
text = []
for p in pages[:20]:
    text.append(pytesseract.image_to_string(p))
print('\\n'.join(text))
"`, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
        return stdout;
    } catch (err) {
        console.error(`[UPLOAD] PDF OCR failed:`, err.message);
        return '';
    }
}

/**
 * Extract text from DOCX via python-docx.
 */
async function extractDocxText(filePath) {
    try {
        const { stdout } = await execAsync(`python3 -c "
from docx import Document
doc = Document('${filePath.replace(/'/g, "\\'")}')
print('\\n'.join(p.text for p in doc.paragraphs))
"`, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
        return stdout;
    } catch (err) {
        console.error(`[UPLOAD] DOCX extraction failed:`, err.message);
        return '';
    }
}

/**
 * Extract text from XLSX via openpyxl.
 */
async function extractXlsxText(filePath) {
    try {
        const { stdout } = await execAsync(`python3 -c "
from openpyxl import load_workbook
wb = load_workbook('${filePath.replace(/'/g, "\\'")}', read_only=True, data_only=True)
lines = []
for ws in wb.worksheets:
    lines.append(f'--- Sheet: {ws.title} ---')
    for row in ws.iter_rows(values_only=True):
        vals = [str(c) if c is not None else '' for c in row]
        if any(vals):
            lines.append('\\t'.join(vals))
wb.close()
print('\\n'.join(lines))
"`, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
        return stdout;
    } catch (err) {
        console.error(`[UPLOAD] XLSX extraction failed:`, err.message);
        return '';
    }
}

/**
 * Extract text from image via PyTesseract OCR.
 */
async function extractImageText(filePath) {
    try {
        const { stdout } = await execAsync(`python3 -c "
import pytesseract
from PIL import Image
img = Image.open('${filePath.replace(/'/g, "\\'")}')
print(pytesseract.image_to_string(img))
"`, { timeout: 60000, maxBuffer: 5 * 1024 * 1024 });
        return stdout;
    } catch (err) {
        console.error(`[UPLOAD] Image OCR failed:`, err.message);
        return '';
    }
}

/**
 * Split text at LESLIE/manager-notes marker.
 * Everything before the marker is general (5-day TTL).
 * Everything after is permanent (no expiry).
 */
function splitAtManagerMarker(text) {
    for (const pattern of MANAGER_PATTERNS) {
        const match = text.match(pattern);
        if (match) {
            const splitIndex = match.index;
            return {
                general: text.substring(0, splitIndex).trim(),
                permanent: text.substring(splitIndex).trim(),
            };
        }
    }
    // No marker found — everything is general
    return { general: text, permanent: '' };
}

/**
 * Pipe text to rag_manager.py index-text via stdin.
 */
async function indexText(text, source, ttlDays, permanent) {
    return new Promise((resolve, reject) => {
        const args = [RAG_SCRIPT, 'index-text', '--source', source, '--ttl', String(ttlDays)];
        if (permanent) args.push('--permanent');

        const proc = execFile('python3', args, { timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
                console.error(`[UPLOAD] Index failed for ${source}:`, err.message);
                resolve({ chunks: 0 });
                return;
            }
            // Parse chunk count from output like "Indexed 15 chunks from ..."
            const match = stdout.match(/Indexed (\d+) chunks/);
            const chunks = match ? parseInt(match[1], 10) : 0;
            resolve({ chunks });
        });

        // Write text to stdin
        proc.stdin.write(text);
        proc.stdin.end();
    });
}
