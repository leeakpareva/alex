/**
 * SkillsSystem — skill management and templates
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// SKILL TEMPLATES
// ============================================================================

const SKILL_ECONOMIC_RESEARCH = `# Economic Research Skill

## Purpose
Conduct comprehensive economic research for NAVADA strategic decisions.

## Capabilities
- Search for macroeconomic data and trends
- Analyze market conditions in target regions (UK, Africa)
- Track regulatory and policy developments
- Monitor currency and commodity movements

## Usage
When researching economic topics:
1. Use web_search for current data
2. Cross-reference multiple sources
3. Save key findings to memory
4. Provide actionable insights with citations

## Focus Areas
- African economic indicators (GDP, FDI, tech investment)
- AI/robotics market sizing and growth
- Regulatory environment for tech startups
- Currency stability and investment climate
`;

const SKILL_WEB_BROWSING = `# Web Browsing Skill

## Purpose
Research information from the web efficiently.

## Capabilities
- Search for current news and information
- Find company and startup data
- Research market trends and analysis
- Verify facts and gather citations

## Best Practices
1. Use specific, targeted search queries
2. Cross-reference important claims
3. Note publication dates for time-sensitive info
4. Save valuable sources to memory for future reference
`;

const SKILL_FILE_MANAGEMENT = `# File Management Skill

## Purpose
Manage files and directories on the Raspberry Pi.

## Capabilities
- Read and write files
- Create directory structures
- Search for files
- Backup important data

## Common Operations
- Reports: Save to ~/.alex/reports/
- Research: Save to ~/.alex/research/
- Code: Save to ~/.alex/projects/
- Data: Save to ~/.alex/data/
`;

const SKILL_CODE_EXECUTION = `# Code Execution Skill

## Purpose
Write and execute code to automate tasks.

## Capabilities
- Python scripts for data analysis
- Bash scripts for system automation
- Node.js for web-related tasks
- SQL for database queries

## Best Practices
1. Test code in small increments
2. Handle errors gracefully
3. Log important operations
4. Save reusable scripts to ~/.alex/scripts/
`;

const SKILL_EMAIL_DRAFTING = `# Email Drafting Skill

## Purpose
Compose professional emails on behalf of NAVADA.

## Email Types
- Partnership and collaboration inquiries
- Partnership outreach
- Founder communications
- Research requests
- Meeting scheduling

## Style Guide
- Professional but warm tone
- Clear and concise
- Action-oriented
- Include relevant context from memory
`;

const SKILL_CALENDAR_MANAGEMENT = `# Calendar Management Skill

## Purpose
Help manage schedules and deadlines.

## Capabilities
- Track upcoming meetings and events
- Set reminders for important dates
- Schedule recurring tasks
- Coordinate across time zones (UK/Africa)

## Best Practices
1. Always confirm time zones
2. Include relevant context in reminders
3. Proactively flag scheduling conflicts
4. Save important dates to memory
`;

const SKILL_STARTUP_ANALYSIS = `# Startup Analysis Skill

## Purpose
Evaluate startups and projects for potential NAVADA partnership or collaboration.

## Analysis Framework
1. **Team**: Founders, experience, track record
2. **Market**: Size, growth, competition
3. **Product**: Technology, differentiation, traction
4. **Financials**: Revenue, burn, runway
5. **Fit**: Alignment with NAVADA mission and focus areas

## Research Process
1. Search for company information and news
2. Find founder backgrounds
3. Identify competitors
4. Look for funding history
5. Assess market opportunity

## Output Format
Provide structured analysis with:
- Executive summary
- Strengths and risks
- Key questions for due diligence
- Recommendation (pass/explore/pursue)
`;

const DEFAULT_SKILLS = {
    'economic-research': SKILL_ECONOMIC_RESEARCH,
    'web-browsing': SKILL_WEB_BROWSING,
    'file-management': SKILL_FILE_MANAGEMENT,
    'code-execution': SKILL_CODE_EXECUTION,
    'email-drafting': SKILL_EMAIL_DRAFTING,
    'calendar-management': SKILL_CALENDAR_MANAGEMENT,
    'startup-analysis': SKILL_STARTUP_ANALYSIS,
};

export class SkillsSystem {
    constructor(workspacePath) {
        this.skillsPath = path.join(workspacePath, 'skills');
    }

    async init() {
        await fs.mkdir(this.skillsPath, { recursive: true });
        await this.installDefaultSkills();
    }

    async installDefaultSkills() {
        for (const [name, content] of Object.entries(DEFAULT_SKILLS)) {
            const skillDir = path.join(this.skillsPath, name);
            const skillFile = path.join(skillDir, 'SKILL.md');

            if (!await this._fileExists(skillFile)) {
                await fs.mkdir(skillDir, { recursive: true });
                await fs.writeFile(skillFile, content);
            }
        }
    }

    async _fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async getAllSkills() {
        const skills = [];
        try {
            const entries = await fs.readdir(this.skillsPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const skillFile = path.join(this.skillsPath, entry.name, 'SKILL.md');
                    try {
                        const content = await fs.readFile(skillFile, 'utf-8');
                        skills.push({ name: entry.name, content });
                    } catch {}
                }
            }
        } catch {}
        return skills;
    }

    async getSkillNames() {
        const skills = await this.getAllSkills();
        return skills.map(s => s.name);
    }

    async getSkillsPrompt() {
        const skills = await this.getAllSkills();
        if (skills.length === 0) return '';

        return `\n\n## Available Skills\n\n${skills.map(s =>
            `### ${s.name}\n${s.content}`
        ).join('\n\n')}`;
    }
}
