/**
 * RequestQueue — rate-limited API call queue with cooldown and parallel workers
 */

const MAX_QUEUE_SIZE = 50;
const MAX_WORKERS = 2; // Allow 2 concurrent API calls

export class RequestQueue {
    constructor() {
        this.queue = [];
        this.activeWorkers = 0;
        this.lastRequestTime = 0;
        this.cooldownUntil = 0;
        this.minInterval = 500; // 500ms minimum between new requests (halved for parallel)
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
        // Spin up workers while capacity available and queue has items
        while (this.queue.length > 0 && this.activeWorkers < MAX_WORKERS) {
            const now = Date.now();

            // Wait for cooldown (global rate limit)
            if (now < this.cooldownUntil) {
                const wait = this.cooldownUntil - now;
                console.log(`[QUEUE] Rate limit cooldown, waiting ${Math.round(wait / 1000)}s...`);
                await new Promise(r => setTimeout(r, wait));
            }

            // Enforce minimum interval between starting new requests
            const elapsed = Date.now() - this.lastRequestTime;
            if (elapsed < this.minInterval) {
                await new Promise(r => setTimeout(r, this.minInterval - elapsed));
            }

            const item = this.queue.shift();
            if (!item) break;

            this.lastRequestTime = Date.now();
            this.activeWorkers++;

            // Process item without blocking the loop (allows parallel execution)
            this._processItem(item).finally(() => {
                this.activeWorkers--;
                // Check for more work after completing
                this._process();
            });
        }
    }

    async _processItem(item) {
        try {
            const result = await item.fn();
            item.resolve(result);
        } catch (error) {
            if (error?.status === 429) {
                this.cooldownUntil = Date.now() + 60000;
                console.log('[QUEUE] 429 received, entering 60s cooldown');
                // Re-queue the failed request at front
                this.queue.unshift(item);
            } else {
                item.reject(error);
            }
        }
    }

    /**
     * Drain the queue: wait for current processing to finish, reject remaining items
     */
    async drain(timeoutMs = 10000) {
        console.log(`[QUEUE] Draining (${this.queue.length} items pending, ${this.activeWorkers} active workers)...`);
        const start = Date.now();
        while (this.activeWorkers > 0 && (Date.now() - start) < timeoutMs) {
            await new Promise(r => setTimeout(r, 200));
        }
        // Reject any remaining queued items
        const remaining = this.queue.splice(0);
        for (const item of remaining) {
            item.reject(new Error('Queue draining — server shutting down'));
        }
        console.log(`[QUEUE] Drained. Rejected ${remaining.length} pending items.`);
    }

    /**
     * Kill: immediately reject all queued items and stop processing
     */
    kill() {
        console.log(`[QUEUE] Kill — rejecting ${this.queue.length} queued items`);
        const remaining = this.queue.splice(0);
        for (const item of remaining) {
            item.reject(new Error('Killed by /kill command'));
        }
        this.activeWorkers = 0;
    }

    get size() {
        return this.queue.length;
    }

    get isProcessing() {
        return this.activeWorkers > 0;
    }
}
