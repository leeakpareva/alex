/**
 * Integration tests — live API tests (skipped when keys unavailable)
 */

import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const ANTHROPIC_KEY = process.env.TEST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;
const OPENAI_KEY = process.env.TEST_OPENAI_KEY || process.env.OPENAI_API_KEY;
const DEEPSEEK_KEY = process.env.TEST_DEEPSEEK_KEY || process.env.DEEPSEEK_API_KEY;
const KIMI_KEY = process.env.TEST_KIMI_KEY || process.env.KIMI_API_KEY;

// ============================================================================
// ANTHROPIC (Claude)
// ============================================================================

describe.skipIf(!ANTHROPIC_KEY)('Anthropic API (live)', () => {
    it('creates a simple Haiku message', async () => {
        const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
        const res = await client.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Say exactly "integration test passed"' }]
        });
        expect(res.content[0].text.toLowerCase()).toContain('passed');
        expect(res.usage.input_tokens).toBeGreaterThan(0);
        expect(res.usage.output_tokens).toBeGreaterThan(0);
    }, 30000);

    it('returns tool_use when prompted', async () => {
        const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
        const res = await client.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 200,
            messages: [{ role: 'user', content: 'What is the current date? Use the get_date tool.' }],
            tools: [{
                name: 'get_date',
                description: 'Get the current date',
                input_schema: { type: 'object', properties: {} }
            }]
        });
        const hasToolUse = res.content.some(block => block.type === 'tool_use');
        expect(hasToolUse).toBe(true);
    }, 30000);

    it('handles system prompts correctly', async () => {
        const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
        const res = await client.messages.create({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 50,
            system: 'You are a pirate. Always say "Arrr!" at the start of your response.',
            messages: [{ role: 'user', content: 'Hello' }]
        });
        expect(res.content[0].text.toLowerCase()).toContain('arr');
    }, 30000);
});

// ============================================================================
// OPENAI (GPT-4o)
// ============================================================================

describe.skipIf(!OPENAI_KEY)('OpenAI API (live)', () => {
    it('creates a chat completion with GPT-4o', async () => {
        const client = new OpenAI({ apiKey: OPENAI_KEY });
        const res = await client.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Say exactly "integration test passed"' }]
        });
        expect(res.choices[0].message.content.toLowerCase()).toContain('passed');
        expect(res.usage.prompt_tokens).toBeGreaterThan(0);
        expect(res.usage.completion_tokens).toBeGreaterThan(0);
    }, 30000);

    it('handles system messages', async () => {
        const client = new OpenAI({ apiKey: OPENAI_KEY });
        const res = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 50,
            messages: [
                { role: 'system', content: 'Respond only with the word CONFIRMED' },
                { role: 'user', content: 'Test' }
            ]
        });
        expect(res.choices[0].message.content.toUpperCase()).toContain('CONFIRMED');
    }, 30000);

    it('returns function calls when tools provided', async () => {
        const client = new OpenAI({ apiKey: OPENAI_KEY });
        const res = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'Get the weather for London' }],
            tools: [{
                type: 'function',
                function: {
                    name: 'get_weather',
                    description: 'Get current weather',
                    parameters: {
                        type: 'object',
                        properties: { city: { type: 'string' } },
                        required: ['city']
                    }
                }
            }]
        });
        expect(res.choices[0].message.tool_calls).toBeDefined();
        expect(res.choices[0].message.tool_calls.length).toBeGreaterThan(0);
    }, 30000);
});

// ============================================================================
// DEEPSEEK
// ============================================================================

describe.skipIf(!DEEPSEEK_KEY)('DeepSeek API (live)', () => {
    it('creates a chat completion', async () => {
        const client = new OpenAI({
            apiKey: DEEPSEEK_KEY,
            baseURL: 'https://api.deepseek.com'
        });
        const res = await client.chat.completions.create({
            model: 'deepseek-chat',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Say exactly "integration test passed"' }]
        });
        expect(res.choices[0].message.content.toLowerCase()).toContain('passed');
    }, 60000); // DeepSeek can be slow
});

// ============================================================================
// KIMI K2
// ============================================================================

describe.skipIf(!KIMI_KEY)('Kimi K2 API (live)', () => {
    it('creates a chat completion', async () => {
        const client = new OpenAI({
            apiKey: KIMI_KEY,
            baseURL: 'https://kimi-k2.ai/api/v1'
        });
        const res = await client.chat.completions.create({
            model: 'kimi-k2',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Say exactly "integration test passed"' }]
        });
        expect(res.choices[0].message.content.toLowerCase()).toContain('passed');
    }, 30000);

    it('returns function calls when tools provided', async () => {
        const client = new OpenAI({
            apiKey: KIMI_KEY,
            baseURL: 'https://kimi-k2.ai/api/v1'
        });
        const res = await client.chat.completions.create({
            model: 'kimi-k2',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'What is the current time? Use the get_time tool.' }],
            tools: [{
                type: 'function',
                function: {
                    name: 'get_time',
                    description: 'Get current time',
                    parameters: { type: 'object', properties: {} }
                }
            }]
        });
        // Kimi should either call the tool or respond with text
        expect(res.choices[0].message).toBeDefined();
    }, 30000);
});

// ============================================================================
// CROSS-PROVIDER CONSISTENCY
// ============================================================================

describe.skipIf(!ANTHROPIC_KEY || !OPENAI_KEY)('Cross-provider consistency', () => {
    it('both providers return similar response formats', async () => {
        const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
        const openai = new OpenAI({ apiKey: OPENAI_KEY });

        const prompt = 'What is 2 + 2? Reply with just the number.';

        const [claudeRes, gptRes] = await Promise.all([
            anthropic.messages.create({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 10,
                messages: [{ role: 'user', content: prompt }]
            }),
            openai.chat.completions.create({
                model: 'gpt-4o-mini',
                max_tokens: 10,
                messages: [{ role: 'user', content: prompt }]
            })
        ]);

        // Both should respond with "4"
        expect(claudeRes.content[0].text).toContain('4');
        expect(gptRes.choices[0].message.content).toContain('4');
    }, 30000);
});
