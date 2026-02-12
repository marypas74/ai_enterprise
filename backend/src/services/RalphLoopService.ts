/**
 * RalphLoopService - Self-referential AI development loop
 * Inspired by https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 *
 * Implements an iterative loop where the AI works on a task, and the same prompt
 * is fed back until completion criteria are met. Works with ANY model (Ollama,
 * OpenAI, Anthropic, Google, etc.)
 */

import { EventEmitter } from 'events';

export interface RalphLoopConfig {
  prompt: string;
  model: string;
  maxIterations?: number;        // 0 = unlimited
  completionPromise?: string;    // Text that signals completion
  userId: number;
  conversationId?: number;
}

export interface RalphLoopState {
  id: string;
  active: boolean;
  prompt: string;
  model: string;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  userId: number;
  conversationId: number | null;
  startedAt: Date;
  lastIterationAt: Date | null;
  outputs: string[];             // Store outputs from each iteration
  status: 'running' | 'completed' | 'stopped' | 'max_iterations' | 'error';
  error?: string;
}

export interface RalphLoopResult {
  success: boolean;
  iteration: number;
  output: string;
  completionDetected: boolean;
  continueLoop: boolean;
}

// In-memory storage for active loops (could be moved to Redis for persistence)
const activeLoops = new Map<string, RalphLoopState>();

class RalphLoopService extends EventEmitter {
  private static instance: RalphLoopService;

  private constructor() {
    super();
  }

  static getInstance(): RalphLoopService {
    if (!RalphLoopService.instance) {
      RalphLoopService.instance = new RalphLoopService();
    }
    return RalphLoopService.instance;
  }

  /**
   * Generate a unique loop ID
   */
  private generateLoopId(): string {
    return `ralph-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Start a new Ralph loop
   */
  startLoop(config: RalphLoopConfig): RalphLoopState {
    const loopId = this.generateLoopId();

    const state: RalphLoopState = {
      id: loopId,
      active: true,
      prompt: config.prompt,
      model: config.model,
      iteration: 0,
      maxIterations: config.maxIterations || 0,
      completionPromise: config.completionPromise || null,
      userId: config.userId,
      conversationId: config.conversationId || null,
      startedAt: new Date(),
      lastIterationAt: null,
      outputs: [],
      status: 'running'
    };

    activeLoops.set(loopId, state);

    console.log(`[RalphLoop] Started loop ${loopId} for user ${config.userId}`);
    console.log(`[RalphLoop] Model: ${config.model}, Max iterations: ${config.maxIterations || 'unlimited'}`);
    if (config.completionPromise) {
      console.log(`[RalphLoop] Completion promise: "${config.completionPromise}"`);
    }

    this.emit('loopStarted', state);
    return state;
  }

  /**
   * Get loop state by ID
   */
  getLoop(loopId: string): RalphLoopState | null {
    return activeLoops.get(loopId) || null;
  }

  /**
   * Get all active loops for a user
   */
  getUserLoops(userId: number): RalphLoopState[] {
    return Array.from(activeLoops.values())
      .filter(loop => loop.userId === userId && loop.active);
  }

  /**
   * Get all active loops
   */
  getAllActiveLoops(): RalphLoopState[] {
    return Array.from(activeLoops.values()).filter(loop => loop.active);
  }

  /**
   * Check if completion promise is detected in output
   */
  private checkCompletionPromise(output: string, completionPromise: string): boolean {
    // Look for <promise>TEXT</promise> pattern
    const promiseRegex = /<promise>(.*?)<\/promise>/is;
    const match = output.match(promiseRegex);

    if (match) {
      const extractedPromise = match[1].trim().replace(/\s+/g, ' ');
      const normalizedTarget = completionPromise.trim().replace(/\s+/g, ' ');
      return extractedPromise.toLowerCase() === normalizedTarget.toLowerCase();
    }

    return false;
  }

  /**
   * Process an iteration of the loop
   * Called after each AI response to determine if loop should continue
   */
  processIteration(loopId: string, output: string): RalphLoopResult {
    const state = activeLoops.get(loopId);

    if (!state || !state.active) {
      return {
        success: false,
        iteration: 0,
        output: '',
        completionDetected: false,
        continueLoop: false
      };
    }

    // Increment iteration
    state.iteration++;
    state.lastIterationAt = new Date();
    state.outputs.push(output);

    console.log(`[RalphLoop] ${loopId} - Iteration ${state.iteration}`);

    // Check max iterations
    if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
      console.log(`[RalphLoop] ${loopId} - Max iterations (${state.maxIterations}) reached`);
      state.active = false;
      state.status = 'max_iterations';
      this.emit('loopMaxIterations', state);

      return {
        success: true,
        iteration: state.iteration,
        output,
        completionDetected: false,
        continueLoop: false
      };
    }

    // Check completion promise
    if (state.completionPromise) {
      const completed = this.checkCompletionPromise(output, state.completionPromise);

      if (completed) {
        console.log(`[RalphLoop] ${loopId} - Completion promise detected!`);
        state.active = false;
        state.status = 'completed';
        this.emit('loopCompleted', state);

        return {
          success: true,
          iteration: state.iteration,
          output,
          completionDetected: true,
          continueLoop: false
        };
      }
    }

    // Continue loop
    this.emit('loopIteration', state);

    return {
      success: true,
      iteration: state.iteration,
      output,
      completionDetected: false,
      continueLoop: true
    };
  }

  /**
   * Get the prompt for the next iteration
   * Includes context from previous iterations
   */
  getNextIterationPrompt(loopId: string): string | null {
    const state = activeLoops.get(loopId);

    if (!state || !state.active) {
      return null;
    }

    // Build context-aware prompt
    let prompt = state.prompt;

    // Add iteration info
    const iterationInfo = `\n\n---\n🔄 **Ralph Loop - Iteration ${state.iteration + 1}**\n`;

    if (state.maxIterations > 0) {
      prompt += iterationInfo + `Max iterations: ${state.maxIterations}\n`;
    } else {
      prompt += iterationInfo + `No iteration limit set.\n`;
    }

    if (state.completionPromise) {
      prompt += `\n⚠️ **IMPORTANT**: To complete this task, output: \`<promise>${state.completionPromise}</promise>\`\n`;
      prompt += `Only output this when the statement is **completely and unequivocally TRUE**.\n`;
      prompt += `Do NOT output false promises to escape the loop.\n`;
    }

    // Add last output as context if available
    if (state.outputs.length > 0) {
      const lastOutput = state.outputs[state.outputs.length - 1];
      prompt += `\n---\n**Your previous output (iteration ${state.iteration}):**\n`;
      prompt += lastOutput.substring(0, 2000); // Limit to avoid context explosion
      if (lastOutput.length > 2000) {
        prompt += '\n... (truncated)';
      }
      prompt += '\n---\n\nContinue working on the task. Review your previous work and improve upon it.\n';
    }

    return prompt;
  }

  /**
   * Stop a loop manually
   */
  stopLoop(loopId: string, reason: string = 'Manual stop'): boolean {
    const state = activeLoops.get(loopId);

    if (!state) {
      return false;
    }

    state.active = false;
    state.status = 'stopped';
    state.error = reason;

    console.log(`[RalphLoop] ${loopId} - Stopped: ${reason}`);
    this.emit('loopStopped', state);

    return true;
  }

  /**
   * Clean up old/inactive loops
   */
  cleanupLoops(maxAgeHours: number = 24): number {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [loopId, state] of activeLoops.entries()) {
      if (!state.active && state.startedAt < cutoff) {
        activeLoops.delete(loopId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[RalphLoop] Cleaned up ${cleaned} old loops`);
    }

    return cleaned;
  }

  /**
   * Get loop statistics
   */
  getStats(): {
    activeLoops: number;
    totalLoops: number;
    byStatus: Record<string, number>;
  } {
    const loops = Array.from(activeLoops.values());
    const byStatus: Record<string, number> = {};

    for (const loop of loops) {
      byStatus[loop.status] = (byStatus[loop.status] || 0) + 1;
    }

    return {
      activeLoops: loops.filter(l => l.active).length,
      totalLoops: loops.length,
      byStatus
    };
  }
}

// Export singleton instance
export const ralphLoopService = RalphLoopService.getInstance();
export default ralphLoopService;
