/**
 * Event Bus - Decoupling bridge between Agents and UI
 * 
 * All Agent-to-UI communication goes through Event Bus.
 * Agents emit events, CLI subscribes and updates UI accordingly.
 * 
 * Features:
 * - Type-safe event system with Zod validation
 * - Fixed event version (1.0)
 * - Wildcard subscription support ('*') for debugging and monitoring
 */

import { EventEmitter } from 'node:events';
import type { AgentEvent, AgentEventType } from '../types/AgentEvent.js';
import { AgentEventSchema } from '../schemas/agent-event.schema.js';

export class EventBus {
    private emitter = new EventEmitter();
    
    /**
     * Emit an event with Schema validation
     */
    emit(event: AgentEvent): void {
        // Schema validation (throws on invalid event)
        const validated = AgentEventSchema.parse(event);
        
        // Emit to subscribers
        this.emitter.emit(event.type, validated);
        
        // Also emit to wildcard listeners
        this.emitter.emit('*', validated);
    }
    
    /**
     * Subscribe to specific event type
     */
    on(type: AgentEventType | '*', handler: (event: AgentEvent) => void): void {
        this.emitter.on(type, handler);
    }
    
    /**
     * Unsubscribe from event type
     */
    off(type: AgentEventType | '*', handler: (event: AgentEvent) => void): void {
        this.emitter.off(type, handler);
    }
    
    /**
     * Subscribe once (auto-unsubscribe after first event)
     */
    once(type: AgentEventType | '*', handler: (event: AgentEvent) => void): void {
        this.emitter.once(type, handler);
    }
    
    /**
     * Get listener count for debugging
     */
    listenerCount(type: AgentEventType | '*'): number {
        return this.emitter.listenerCount(type);
    }
    
    /**
     * Remove all listeners (for cleanup)
     */
    removeAllListeners(type?: AgentEventType | '*'): void {
        this.emitter.removeAllListeners(type);
    }
}

