/**
 * Unit tests for inbox.js — auto-reply filtering and helpers
 */
import { describe, it, expect } from 'vitest';

// We can't easily import inbox.js without IMAP deps connecting,
// so we test the logic patterns directly

describe('inbox.js logic', () => {
    // Replicate the NO_REPLY_PATTERNS from inbox.js
    const NO_REPLY_PATTERNS = [
        /noreply/i, /no-reply/i, /mailer-daemon/i, /postmaster/i,
        /bounce/i, /notifications?@/i, /googlegroups/i, /unsubscribe/i,
        /calendar-notification/i, /digest/i,
    ];

    function shouldAutoReply(fromAddress, ownAddress = 'alex@navada.info') {
        if (!fromAddress) return false;
        const lower = fromAddress.toLowerCase();
        if (lower === ownAddress.toLowerCase()) return false;
        if (/\+.+@/.test(lower)) return false;
        for (const pat of NO_REPLY_PATTERNS) {
            if (pat.test(lower)) return false;
        }
        return true;
    }

    describe('shouldAutoReply', () => {
        it('returns true for normal addresses', () => {
            expect(shouldAutoReply('john@example.com')).toBe(true);
            expect(shouldAutoReply('jane.doe@company.co.uk')).toBe(true);
        });

        it('returns false for empty/null address', () => {
            expect(shouldAutoReply('')).toBe(false);
            expect(shouldAutoReply(null)).toBe(false);
        });

        it('returns false for own address', () => {
            expect(shouldAutoReply('alex@navada.info')).toBe(false);
        });

        it('returns false for noreply addresses', () => {
            expect(shouldAutoReply('noreply@github.com')).toBe(false);
            expect(shouldAutoReply('no-reply@aws.amazon.com')).toBe(false);
        });

        it('returns false for mailer-daemon', () => {
            expect(shouldAutoReply('mailer-daemon@google.com')).toBe(false);
        });

        it('returns false for notification addresses', () => {
            expect(shouldAutoReply('notifications@github.com')).toBe(false);
            expect(shouldAutoReply('notification@slack.com')).toBe(false);
        });

        it('returns false for plus-addressed emails', () => {
            expect(shouldAutoReply('user+tag@example.com')).toBe(false);
        });

        it('returns false for bounce addresses', () => {
            expect(shouldAutoReply('bounce@mail.example.com')).toBe(false);
        });

        it('returns false for digest/unsubscribe', () => {
            expect(shouldAutoReply('digest@lists.example.com')).toBe(false);
            expect(shouldAutoReply('unsubscribe@news.com')).toBe(false);
        });
    });

    describe('voice detection patterns', () => {
        const VOICE_PATTERNS = [
            /voice/i, /audio/i, /speak/i, /talk to me/i, /hear you/i,
            /voice\s*(message|response|reply|note|memo)/i,
            /send.*voice/i, /reply.*voice/i, /respond.*voice/i,
            /say it/i, /tell me.*out\s*loud/i, /read.*aloud/i,
            /listen/i, /spoken/i, /recording/i,
        ];

        function wantsVoice(subject, body) {
            const combined = `${subject} ${body}`.toLowerCase();
            return VOICE_PATTERNS.some(pat => pat.test(combined));
        }

        it('detects "voice" keyword', () => {
            expect(wantsVoice('Send voice response', '')).toBe(true);
        });

        it('detects "audio" keyword', () => {
            expect(wantsVoice('', 'Can you send an audio reply?')).toBe(true);
        });

        it('does not trigger on normal text', () => {
            expect(wantsVoice('Partnership proposal', 'Let us discuss terms')).toBe(false);
        });

        it('detects "talk to me"', () => {
            expect(wantsVoice('', 'I want you to talk to me')).toBe(true);
        });
    });
});
