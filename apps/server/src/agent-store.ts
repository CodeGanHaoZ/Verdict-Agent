import {
  canonical_json,
  type AgentDraft,
  type AgentSnapshot,
  type AgentEvent,
} from "@verdict/protocol";
import { Store, ApiError } from "./store.js";
export class AgentStore {
  constructor(readonly store: Store,readonly observe?:(event:AgentEvent)=>void) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS agent_drafts(id TEXT PRIMARY KEY,client_id TEXT UNIQUE NOT NULL,input_hash TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agents(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_requests(client_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,agent_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_events(agent_id TEXT NOT NULL,sequence INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(agent_id,sequence));`);
    for (const row of store.db
      .prepare("SELECT body FROM agent_drafts")
      .all() as { body: string }[]) {
      const d = JSON.parse(row.body) as AgentDraft;
      if (d.status === "GENERATING") {
        d.status = "ERROR";
        d.error = "INTERRUPTED";
        this.saveDraft(d);
      }
    }
    for (const row of store.db.prepare("SELECT body FROM agents").all() as {
      body: string;
    }[]) {
      const a = JSON.parse(row.body) as AgentSnapshot;
      if (a.status === "RUNNING" || a.status === "QUEUED") {
        a.status = "ERROR";
        a.modelStatus = "ERROR";
        a.error = "INTERRUPTED";
        a.finishedAt = new Date().toISOString();
        this.saveAgent(a);
        this.event(a.agentId, "ERROR", { reason: "INTERRUPTED" });
      }
    }
  }
  reserveAgent(snapshot: AgentSnapshot, clientId: string, inputHash: string) {
    return this.store.transaction(() => {
      const old = this.store.db
        .prepare(
          "SELECT input_hash,agent_id FROM agent_requests WHERE client_id=?",
        )
        .get(clientId) as { input_hash: string; agent_id: string } | undefined;
      if (old) {
        if (old.input_hash !== inputHash)
          throw new ApiError(409, "AGENT_REQUEST_CONFLICT");
        return { snapshot: this.agent(old.agent_id), fresh: false };
      }
      this.saveAgent(snapshot);
      this.store.db
        .prepare("INSERT INTO agent_requests VALUES(?,?,?)")
        .run(clientId, inputHash, snapshot.agentId);
      return { snapshot, fresh: true };
    });
  }
  reserveDraft(draft: AgentDraft, inputHash: string) {
    return this.store.transaction(() => {
      const old = this.store.db
        .prepare("SELECT input_hash,body FROM agent_drafts WHERE client_id=?")
        .get(draft.clientRequestId) as
        | { input_hash: string; body: string }
        | undefined;
      if (old) {
        if (old.input_hash !== inputHash)
          throw new ApiError(409, "DRAFT_REQUEST_CONFLICT");
        return { draft: JSON.parse(old.body) as AgentDraft, fresh: false };
      }
      this.store.db
        .prepare("INSERT INTO agent_drafts VALUES(?,?,?,?)")
        .run(
          draft.draftId,
          draft.clientRequestId,
          inputHash,
          canonical_json(draft),
        );
      return { draft, fresh: true };
    });
  }
  draft(id: string): AgentDraft {
    const r = this.store.db
      .prepare("SELECT body FROM agent_drafts WHERE id=?")
      .get(id) as { body: string } | undefined;
    if (!r) throw new ApiError(404, "DRAFT_NOT_FOUND");
    return JSON.parse(r.body);
  }
  saveDraft(d: AgentDraft) {
    this.store.db
      .prepare("UPDATE agent_drafts SET body=? WHERE id=?")
      .run(canonical_json(d), d.draftId);
  }
  agent(id: string): AgentSnapshot {
    const r = this.store.db
      .prepare("SELECT body FROM agents WHERE id=?")
      .get(id) as { body: string } | undefined;
    if (!r) throw new ApiError(404, "AGENT_NOT_FOUND");
    return JSON.parse(r.body);
  }
  saveAgent(a: AgentSnapshot) {
    this.store.db
      .prepare(
        "INSERT INTO agents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(a.agentId, canonical_json(a));
  }
  event(
    id: string,
    type: AgentEvent["type"],
    data: unknown,
    tool?: { toolName: string; toolCallId: string },
  ) {
    return this.store.transaction(() => {
      const a = this.agent(id);
      const ev: AgentEvent = {
        agentId: id,
        sequence: a.eventSequence + 1,
        at: new Date().toISOString(),
        type,
        data,
        ...tool,
      };
      a.eventSequence = ev.sequence;
      this.saveAgent(a);
      this.store.db
        .prepare("INSERT INTO agent_events VALUES(?,?,?)")
        .run(id, ev.sequence, canonical_json(ev));
      try{this.observe?.(ev);}catch{}
      return ev;
    });
  }
  events(id: string, after: number): AgentEvent[] {
    this.agent(id);
    return (
      this.store.db
        .prepare(
          "SELECT body FROM agent_events WHERE agent_id=? AND sequence>? ORDER BY sequence LIMIT 200",
        )
        .all(id, after) as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
}
