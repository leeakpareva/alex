/**
 * KeywordIndex — inverted index with TF scoring for memory_recall fallback
 */

import fs from 'fs/promises';
import path from 'path';

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
    'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very',
    'just', 'because', 'if', 'when', 'while', 'this', 'that', 'these',
    'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
    'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what',
    'which', 'who', 'whom', 'how', 'where', 'why', 'about',
]);

function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

export class KeywordIndex {
    constructor(workspacePath) {
        this.indexPath = path.join(workspacePath, 'keyword-index.json');
        this.index = {}; // word → [{ source, snippet, score }]
    }

    async load() {
        try {
            const raw = await fs.readFile(this.indexPath, 'utf-8');
            this.index = JSON.parse(raw);
        } catch {
            this.index = {};
        }
    }

    async save() {
        await fs.writeFile(this.indexPath, JSON.stringify(this.index));
    }

    addDocument(source, text) {
        const words = tokenize(text);
        const wordCounts = {};
        for (const w of words) {
            wordCounts[w] = (wordCounts[w] || 0) + 1;
        }
        const snippet = text.substring(0, 200);
        for (const [word, count] of Object.entries(wordCounts)) {
            if (!this.index[word]) this.index[word] = [];
            // Avoid duplicate sources
            const existing = this.index[word].find(e => e.source === source);
            if (existing) {
                existing.score = count;
                existing.snippet = snippet;
            } else {
                this.index[word].push({ source, snippet, score: count });
            }
            // Keep only top 20 entries per word
            if (this.index[word].length > 20) {
                this.index[word].sort((a, b) => b.score - a.score);
                this.index[word].length = 20;
            }
        }
    }

    search(query, maxResults = 5) {
        const queryWords = tokenize(query);
        if (queryWords.length === 0) return [];

        const scores = {}; // source → total score
        const snippets = {}; // source → snippet
        for (const word of queryWords) {
            const entries = this.index[word] || [];
            for (const entry of entries) {
                scores[entry.source] = (scores[entry.source] || 0) + entry.score;
                snippets[entry.source] = entry.snippet;
            }
        }

        return Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, maxResults)
            .map(([source, score]) => ({ source, score, snippet: snippets[source] }));
    }
}
