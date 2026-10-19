import { createHmac, randomBytes } from "crypto";
import { eq, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { chatSessions } from "@/db/schema";
import { env } from "@/lib/env";
import { withDb } from "@/lib/errors";
import { initialState } from "./engine";
import type { ChatState } from "./types";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function newChatToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHmac("sha256", env().CHAT_TOKEN_SECRET).update(token).digest("hex");
}

export function isValidTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Loads conversation state. Expired or unknown sessions return null. */
export async function loadChatState(token: string): Promise<ChatState | null> {
  return withDb(async () => {
    const [row] = await getDb().select().from(chatSessions).where(eq(chatSessions.tokenHash, hashToken(token)));
    if (!row) return null;
    if (Date.now() - row.updatedAt.getTime() > SESSION_TTL_MS) return null;
    const s = row.state as ChatState;
    return s && s.v === 1 ? s : null;
  });
}

export async function saveChatState(token: string, state: ChatState): Promise<void> {
  await withDb(() =>
    getDb()
      .insert(chatSessions)
      .values({ tokenHash: hashToken(token), state })
      .onConflictDoUpdate({ target: chatSessions.tokenHash, set: { state, updatedAt: new Date() } }),
  );
}

/** Conversation drafts are only kept for a day; submitted enquiries live in `enquiries`. */
export async function purgeExpiredChatSessions(): Promise<number> {
  return withDb(async () => {
    const rows = await getDb()
      .delete(chatSessions)
      .where(lt(chatSessions.updatedAt, new Date(Date.now() - SESSION_TTL_MS)))
      .returning({ id: chatSessions.id });
    return rows.length;
  });
}

export { initialState };
