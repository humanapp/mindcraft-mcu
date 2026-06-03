/**
 * App-owned shared medium for simulator instances. Each instance registers on create and
 * unregisters on destroy. Cross-device signals (radio, ambient sound, microphone) pass between
 * instances through this medium.
 */
export class SharedMedium {
  private readonly registered = new Set<string>();

  /** Registers an instance into the medium. */
  register(instanceId: string): void {
    this.registered.add(instanceId);
  }

  /** Removes an instance from the medium. */
  unregister(instanceId: string): void {
    this.registered.delete(instanceId);
  }

  /** Whether an instance is currently registered. */
  has(instanceId: string): boolean {
    return this.registered.has(instanceId);
  }

  /** Number of registered instances. */
  size(): number {
    return this.registered.size;
  }
}
