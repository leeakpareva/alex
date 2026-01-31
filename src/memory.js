/**
 * MemorySystem — persistent memory, conversations, identity, knowledge
 */

import fs from 'fs/promises';
import path from 'path';

export const IDENTITY_TEMPLATE = `# ALEX - Global Economist

## Who I Am
I am ALEX, the Global Economist at NAVADA — an AI-first innovation studio focused on AI engineering, robotics, creative technology, and community education. I run 24/7 on a dedicated Raspberry Pi with full system access.

## My Role
I serve as a senior AI economist and colleague to the team, handling:
- Global macroeconomic research and analysis
- AI platform economics and digital product strategy
- Technology adoption analysis and creative technology economics
- Community impact assessment
- African tech ecosystem monitoring
- Market intelligence and trend analysis
- Administrative tasks and scheduling
- Technical projects and automation

## My Personality
- Professional but personable - I'm a senior colleague, not a servant
- Proactive - I anticipate needs, surface economic insights, and flag market movements
- Warm, calm, friendly, and professional in all interactions
- Analytical - I think in terms of data, trends, and strategic implications
- Reliable - I follow through on tasks and remember context across all conversations

## My Capabilities
- Full access to this Raspberry Pi system (bash, files, networking, sudo)
- Web research and real-time information gathering
- File management and code execution
- Email composition and scheduling
- Persistent memory across all conversations (500-message history)
- Self-improvement through creating new skills
- 24/7 availability and autonomous operation

## My Values
- I prioritize the team's time and NAVADA's mission
- I maintain confidentiality of sensitive business information
- I am honest about my limitations and uncertainties
- I continuously learn and adapt to be more helpful
- I think like an economist - data-driven, analytical, strategic
`;

export class MemorySystem {
    constructor(workspacePath) {
        this.memoryPath = path.join(workspacePath, 'memory');
        this.conversationPath = path.join(workspacePath, 'conversations');
        this.userPath = path.join(workspacePath, 'USER.md');
        this.identityPath = path.join(workspacePath, 'IDENTITY.md');
        this.knowledgePath = path.join(workspacePath, 'KNOWLEDGE.md');
    }

    async init() {
        await fs.mkdir(this.memoryPath, { recursive: true });
        await fs.mkdir(this.conversationPath, { recursive: true });

        if (!await this.fileExists(this.userPath)) {
            await this.saveUserMemory({
                name: 'Lee',
                role: 'Founder, NAVADA',
                preferences: [],
                facts: [],
                lastUpdated: new Date().toISOString()
            });
        }

        if (!await this.fileExists(this.identityPath)) {
            await fs.writeFile(this.identityPath, IDENTITY_TEMPLATE);
        }

        if (!await this.fileExists(this.knowledgePath)) {
            await fs.writeFile(this.knowledgePath, '# ALEX Knowledge Base\n\nLearned information will be stored here.\n');
        }
    }

    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async getUserMemory() {
        try {
            return await fs.readFile(this.userPath, 'utf-8');
        } catch {
            return '';
        }
    }

    async saveUserMemory(data) {
        const markdown = `# User Profile: ${data.name}

## Role
${data.role}

## Preferences
${data.preferences.map(p => `- ${p}`).join('\n') || '- None recorded yet'}

## Known Facts
${data.facts.map(f => `- ${f}`).join('\n') || '- None recorded yet'}

## Last Updated
${data.lastUpdated}
`;
        await fs.writeFile(this.userPath, markdown);
    }

    async appendMemory(category, content) {
        const memoryFile = path.join(this.memoryPath, `${category}.md`);
        const timestamp = new Date().toISOString();
        const entry = `\n## ${timestamp}\n${content}\n`;
        await fs.appendFile(memoryFile, entry);
    }

    async getMemory(category) {
        const memoryFile = path.join(this.memoryPath, `${category}.md`);
        try {
            return await fs.readFile(memoryFile, 'utf-8');
        } catch {
            return '';
        }
    }

    async saveConversation(chatId, messages, summary = null) {
        const convFile = path.join(this.conversationPath, `${chatId}.json`);
        const trimmed = messages.slice(-100);
        const data = { messages: trimmed, summary: summary || null };
        await fs.writeFile(convFile, JSON.stringify(data, null, 2));
    }

    async getConversation(chatId) {
        const convFile = path.join(this.conversationPath, `${chatId}.json`);
        try {
            const content = await fs.readFile(convFile, 'utf-8');
            const parsed = JSON.parse(content);
            // Handle both old format (plain array) and new format ({messages, summary})
            if (Array.isArray(parsed)) {
                return { messages: parsed, summary: null };
            }
            return { messages: parsed.messages || [], summary: parsed.summary || null };
        } catch {
            return { messages: [], summary: null };
        }
    }

    async getIdentity() {
        try {
            return await fs.readFile(this.identityPath, 'utf-8');
        } catch {
            return IDENTITY_TEMPLATE;
        }
    }

    async getKnowledge() {
        try {
            return await fs.readFile(this.knowledgePath, 'utf-8');
        } catch {
            return '';
        }
    }

    async appendKnowledge(content, reindexFn) {
        const timestamp = new Date().toISOString();
        const entry = `\n## Learned: ${timestamp}\n${content}\n`;
        await fs.appendFile(this.knowledgePath, entry);
        await this.trimKnowledge();
        if (reindexFn) reindexFn();
    }

    async trimKnowledge() {
        try {
            const content = await fs.readFile(this.knowledgePath, 'utf-8');
            const lines = content.split('\n');
            if (lines.length > 10000) {
                const header = lines.slice(0, 10);
                const recent = lines.slice(-8000);
                const trimmed = [...header, '\n<!-- Trimmed older entries -->\n', ...recent].join('\n');
                await fs.writeFile(this.knowledgePath, trimmed);
                console.log(`[KNOWLEDGE] Trimmed from ${lines.length} to ~8010 lines`);
            }
        } catch {}
    }

    /**
     * Clean up conversations older than 30 days
     */
    async cleanupOldConversations() {
        try {
            const files = await fs.readdir(this.conversationPath);
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            let cleaned = 0;
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const filePath = path.join(this.conversationPath, file);
                const stat = await fs.stat(filePath);
                if (stat.mtimeMs < cutoff) {
                    await fs.unlink(filePath);
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                console.log(`[MEMORY] Cleaned up ${cleaned} conversations older than 30 days`);
            }
        } catch (err) {
            console.error('[MEMORY] Cleanup error:', err.message);
        }
    }
}
