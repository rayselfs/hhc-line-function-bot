import type { DriveItem, LineSource } from "../types.js";

export interface PptSelectionSession {
  id: string;
  type: "ppt_selection";
  profileName: string;
  requesterUserId?: string;
  source: LineSource;
  driveId: string;
  items: Array<Pick<DriveItem, "id" | "name">>;
  expiresAt: string;
}

export type ConversationSession = PptSelectionSession;

export interface SessionStore {
  get(id: string): ConversationSession | undefined;
  set(session: ConversationSession): void;
  delete(id: string): void;
}

export interface InMemorySessionStoreOptions {
  now?: () => Date;
  ttlMs?: number;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(options: InMemorySessionStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  }

  get(id: string): ConversationSession | undefined {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }
    if (new Date(session.expiresAt).getTime() <= this.now().getTime()) {
      this.sessions.delete(id);
      return undefined;
    }
    return session;
  }

  set(session: ConversationSession): void {
    this.sessions.set(session.id, {
      ...session,
      expiresAt: session.expiresAt || new Date(this.now().getTime() + this.ttlMs).toISOString()
    });
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
