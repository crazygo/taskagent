/**
 * EventCollector - Buffers and truncates child agent events for summarization
 * 
 * Responsibilities:
 * - Collect tool_use and text events from child agents
 * - Truncate large content (file content, diffs) to manageable size
 * - Determine when to trigger summary (time-based or count-based)
 */

import { addLog } from '@shared/logger';

export interface TruncatedEvent {
    type: string;
    timestamp: number;
    data: any;
}

export class EventCollector {
    private buffer: TruncatedEvent[] = [];
    private startTime: number = Date.now();
    private readonly MAX_EVENTS = 10;
    private readonly MAX_TIME_MS = 30000; // 30 seconds

    /**
     * Add an event to the buffer (with truncation)
     */
    add(event: any): void {
        const truncated = this.truncateEvent(event);
        this.buffer.push({
            type: event.level || event.type || 'unknown',
            timestamp: Date.now(),
            data: truncated,
        });
        
        addLog(`[EventCollector] Buffered event, count=${this.buffer.length}`);
    }

    /**
     * Check if we should trigger a summary
     */
    shouldSummarize(): boolean {
        const countThreshold = this.buffer.length >= this.MAX_EVENTS;
        const timeThreshold = (Date.now() - this.startTime) >= this.MAX_TIME_MS;
        
        return countThreshold || timeThreshold;
    }

    /**
     * Check if there are any events
     */
    hasEvents(): boolean {
        return this.buffer.length > 0;
    }

    /**
     * Get event count
     */
    count(): number {
        return this.buffer.length;
    }

    /**
     * Get all buffered events and clear the buffer
     */
    flush(): TruncatedEvent[] {
        const events = [...this.buffer];
        this.buffer = [];
        this.startTime = Date.now(); // Reset timer
        addLog(`[EventCollector] Flushed ${events.length} events`);
        return events;
    }

    /**
     * Truncate event content to prevent overwhelming the summarizer
     */
    private truncateEvent(event: any): any {
        // If it's a simple message event
        if (event.message && typeof event.message === 'string') {
            return {
                type: 'text',
                content: this.truncateText(event.message, 200),
            };
        }

        // If it's a tool_use event (from Claude SDK)
        if (event.name && event.input) {
            const truncatedInput = this.truncateToolInput(event.name, event.input);
            return {
                type: 'tool_use',
                name: event.name,
                input: truncatedInput,
            };
        }

        // Return as-is if we don't know how to truncate
        return event;
    }

    /**
     * Truncate tool input based on tool type
     */
    private truncateToolInput(toolName: string, input: any): any {
        const result: any = {};

        // Preserve file_path, command, description (usually short)
        if (input.file_path) result.file_path = input.file_path;
        if (input.command) result.command = input.command;
        if (input.description) result.description = input.description;

        // Truncate large content fields
        if (input.content) {
            result.content = this.truncateContent(input.content);
        }

        // Truncate diff (max 20 lines)
        if (input.diff) {
            result.diff = this.truncateDiff(input.diff);
        }

        // Pass through other small fields
        Object.keys(input).forEach(key => {
            if (!result[key] && typeof input[key] === 'string' && input[key].length < 100) {
                result[key] = input[key];
            }
        });

        return result;
    }

    /**
     * Truncate content to first 3 + last 3 lines
     */
    private truncateContent(content: string): string {
        if (content.length <= 200) return content;

        const lines = content.split('\n');
        if (lines.length <= 6) return content;

        const firstThree = lines.slice(0, 3).join('\n');
        const lastThree = lines.slice(-3).join('\n');
        
        return `${firstThree}\n...\n${lastThree}`;
    }

    /**
     * Truncate diff to max 20 lines
     */
    private truncateDiff(diff: string): string {
        const lines = diff.split('\n');
        if (lines.length <= 20) return diff;

        return lines.slice(0, 20).join('\n') + '\n... (truncated)';
    }

    /**
     * Truncate plain text to max length
     */
    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }
}
