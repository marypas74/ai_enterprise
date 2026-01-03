import { AgentEventEmitter } from './AgentEventEmitter.js';

export interface TerminalSlot {
  slot: number;
  sessionId: number | null;
  sessionName: string | null;
  status: 'available' | 'occupied' | 'reserved';
  assignedAt: Date | null;
}

class TerminalManagerClass {
  private static instance: TerminalManagerClass;
  private slots: Map<number, TerminalSlot> = new Map();
  private readonly MAX_TERMINALS = 12;

  private constructor() {
    // Initialize all 12 terminal slots
    for (let i = 0; i < this.MAX_TERMINALS; i++) {
      this.slots.set(i, {
        slot: i,
        sessionId: null,
        sessionName: null,
        status: 'available',
        assignedAt: null
      });
    }
  }

  public static getInstance(): TerminalManagerClass {
    if (!TerminalManagerClass.instance) {
      TerminalManagerClass.instance = new TerminalManagerClass();
    }
    return TerminalManagerClass.instance;
  }

  // Get all terminal slots status
  public getAllSlots(): TerminalSlot[] {
    return Array.from(this.slots.values()).sort((a, b) => a.slot - b.slot);
  }

  // Get a specific slot
  public getSlot(slotNumber: number): TerminalSlot | null {
    return this.slots.get(slotNumber) || null;
  }

  // Get available slot count
  public getAvailableCount(): number {
    return Array.from(this.slots.values()).filter(s => s.status === 'available').length;
  }

  // Find first available slot
  public findAvailableSlot(): number | null {
    for (const [slotNumber, slot] of this.slots.entries()) {
      if (slot.status === 'available') {
        return slotNumber;
      }
    }
    return null;
  }

  // Assign a session to a terminal slot
  public assignSlot(sessionId: number, sessionName: string, preferredSlot?: number): number | null {
    let targetSlot: number | null = null;

    // Try preferred slot first if specified
    if (preferredSlot !== undefined && preferredSlot >= 0 && preferredSlot < this.MAX_TERMINALS) {
      const slot = this.slots.get(preferredSlot);
      if (slot && slot.status === 'available') {
        targetSlot = preferredSlot;
      }
    }

    // If preferred slot not available, find any available slot
    if (targetSlot === null) {
      targetSlot = this.findAvailableSlot();
    }

    // If no slot available, return null
    if (targetSlot === null) {
      return null;
    }

    // Assign the slot
    this.slots.set(targetSlot, {
      slot: targetSlot,
      sessionId,
      sessionName,
      status: 'occupied',
      assignedAt: new Date()
    });

    // Emit event
    AgentEventEmitter.terminalAssigned(sessionId, targetSlot);

    return targetSlot;
  }

  // Reserve a slot temporarily (e.g., during session initialization)
  public reserveSlot(slotNumber?: number): number | null {
    let targetSlot: number | null = slotNumber ?? null;

    if (targetSlot === null) {
      targetSlot = this.findAvailableSlot();
    }

    if (targetSlot === null || targetSlot < 0 || targetSlot >= this.MAX_TERMINALS) {
      return null;
    }

    const slot = this.slots.get(targetSlot);
    if (!slot || slot.status !== 'available') {
      return null;
    }

    this.slots.set(targetSlot, {
      ...slot,
      status: 'reserved',
      assignedAt: new Date()
    });

    return targetSlot;
  }

  // Release a terminal slot
  public releaseSlot(slotNumber: number): boolean {
    const slot = this.slots.get(slotNumber);
    if (!slot) {
      return false;
    }

    const wasOccupied = slot.status === 'occupied';

    this.slots.set(slotNumber, {
      slot: slotNumber,
      sessionId: null,
      sessionName: null,
      status: 'available',
      assignedAt: null
    });

    if (wasOccupied) {
      AgentEventEmitter.terminalReleased(slotNumber);
    }

    return true;
  }

  // Release slot by session ID
  public releaseBySessionId(sessionId: number): boolean {
    for (const [slotNumber, slot] of this.slots.entries()) {
      if (slot.sessionId === sessionId) {
        return this.releaseSlot(slotNumber);
      }
    }
    return false;
  }

  // Get slot number for a session
  public getSlotForSession(sessionId: number): number | null {
    for (const [slotNumber, slot] of this.slots.entries()) {
      if (slot.sessionId === sessionId) {
        return slotNumber;
      }
    }
    return null;
  }

  // Check if session has a terminal assigned
  public hasTerminal(sessionId: number): boolean {
    return this.getSlotForSession(sessionId) !== null;
  }

  // Get system metrics
  public getMetrics(): {
    totalSlots: number;
    availableSlots: number;
    occupiedSlots: number;
    reservedSlots: number;
    utilizationPercentage: number;
  } {
    const slots = Array.from(this.slots.values());
    const available = slots.filter(s => s.status === 'available').length;
    const occupied = slots.filter(s => s.status === 'occupied').length;
    const reserved = slots.filter(s => s.status === 'reserved').length;

    return {
      totalSlots: this.MAX_TERMINALS,
      availableSlots: available,
      occupiedSlots: occupied,
      reservedSlots: reserved,
      utilizationPercentage: Math.round((occupied / this.MAX_TERMINALS) * 100)
    };
  }

  // Sync with database (call after restart to restore state)
  public async syncFromDatabase(db: any): Promise<void> {
    try {
      const [rows] = await db.execute(`
        SELECT terminal_slot, id, name, status
        FROM agent_sessions
        WHERE status IN ('running', 'paused', 'initializing')
        AND terminal_slot IS NOT NULL
      `);

      // Reset all slots first
      for (let i = 0; i < this.MAX_TERMINALS; i++) {
        this.slots.set(i, {
          slot: i,
          sessionId: null,
          sessionName: null,
          status: 'available',
          assignedAt: null
        });
      }

      // Assign slots from database
      for (const row of rows as any[]) {
        if (row.terminal_slot >= 0 && row.terminal_slot < this.MAX_TERMINALS) {
          this.slots.set(row.terminal_slot, {
            slot: row.terminal_slot,
            sessionId: row.id,
            sessionName: row.name,
            status: 'occupied',
            assignedAt: new Date()
          });
        }
      }
    } catch (err) {
      console.error('Failed to sync terminal slots from database:', err);
    }
  }
}

export const TerminalManager = TerminalManagerClass.getInstance();
