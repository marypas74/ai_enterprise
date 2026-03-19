const HEALTH_CHECK_URL = 'https://www.aitmpl.com/';
const TIMEOUT_MS = 5000;
const SUSPENSION_THRESHOLD = 3;

export class HealthChecker {
  private consecutiveFailures = 0;
  private suspended = false;

  async check(): Promise<boolean> {
    try {
      const response = await fetch(HEALTH_CHECK_URL, {
        method: 'HEAD',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.ok) {
        this.consecutiveFailures = 0;
        return true;
      }

      this.recordFailure();
      return false;
    } catch {
      this.recordFailure();
      return false;
    }
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  resume(): void {
    this.consecutiveFailures = 0;
    this.suspended = false;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= SUSPENSION_THRESHOLD) {
      this.suspended = true;
    }
  }
}
