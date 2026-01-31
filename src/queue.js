/**
 * RequestQueue — rate-limited API call queue with cooldown
 */

const MAX_QUEUE_SIZE = 50;

export class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequestTime = 0;
        this.cooldownUntil = 0;
        this.minInterval = 1000; // 1s minimum between API calls
    }

    async enqueue(fn, priority = 1) {
        if (this.queue.length >= MAX_QUEUE_SIZE) {
            throw new Error(`Queue full (max ${MAX_QUEUE_SIZE} items). Try again later.`);
        }
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, priority, resolve, reject });
            this.queue.sort((a, b) => b.priority - a.priority);
            this._process();
        });
    }

    async _process() {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const now = Date.now();

            // Wait for cooldown
            if (now < this.cooldownUntil) {
                const wait = this.cooldownUntil - now;
                console.log(`[QUEUE] Rate limit cooldown, waiting ${Math.round(wait / 1000)}s...`);
                await new Promise(r => setTimeout(r, wait));
            }

            // Enforce minimum interval
            const elapsed = Date.now() - this.lastRequestTime;
            if (elapsed < this.minInterval) {
                await new Promise(r => setTimeout(r, this.minInterval - elapsed));
            }

            const item = this.queue.shift();
            this.lastRequestTime = Date.now();

            try {
                const result = await item.fn();
                item.resolve(result);
            } catch (error) {
                if (error?.status === 429) {
                    this.cooldownUntil = Date.now() + 60000;
                    console.log('[QUEUE] 429 received, entering 60s cooldown');
                    // Re-queue the failed request
                    this.queue.unshift(item);
                } else {
                    item.reject(error);
                }
            }
        }

        this.processing = false;
    }
}
