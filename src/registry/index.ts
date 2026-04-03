import type { ResourceHandler } from './handler.js';

export class ResourceHandlerRegistry {
  private handlers = new Map<string, ResourceHandler>();

  register(handler: ResourceHandler): void {
    this.handlers.set(handler.resourceType, handler);
  }

  get(resourceType: string): ResourceHandler | undefined {
    return this.handlers.get(resourceType);
  }

  has(resourceType: string): boolean {
    return this.handlers.has(resourceType);
  }

  /** Returns all registered resource type strings in ascending alphabetical order. */
  listSupported(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
