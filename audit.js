/* Shared append-only audit helper for FAR workflows.
 * Firestore is the primary audit ledger. Google Sheet mirroring is queued as a
 * secondary copy for finance/auditor convenience.
 */

function safeString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function makeAuditId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `aud_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function recordAudit({
  db,
  addDoc,
  collection,
  serverTimestamp,
  queueSheetWrite,
  entityId,
  actor = {},
  action,
  assetId = "",
  targetType = "asset",
  targetId = "",
  oldValue = "",
  newValue = "",
  notes = "",
  source = "web",
  requestId = "",
}) {
  if (!entityId) throw new Error("Audit failed: missing entityId");
  if (!action) throw new Error("Audit failed: missing action");

  const auditId = makeAuditId();
  const actorEmail = actor.email || "unknown";
  const actorRole = actor.role || "unknown";
  const effectiveTargetId = targetId || assetId || "";
  const oldText = safeString(oldValue);
  const newText = safeString(newValue);
  const noteText = safeString(notes);

  const payload = {
    audit_id: auditId,
    entity_id: entityId,
    timestamp: serverTimestamp(),
    actor_uid: actor.uid || "",
    user_email: actorEmail,
    user_role: actorRole,
    action,
    target_type: targetType,
    target_id: effectiveTargetId,
    asset_id: assetId || effectiveTargetId,
    old_value: oldText,
    new_value: newText,
    notes: noteText,
    source,
    request_id: requestId,
  };

  await addDoc(collection(db, "entities", entityId, "audit_log"), payload);

  if (queueSheetWrite) {
    const sheetRow = [
      auditId,
      new Date().toISOString(),
      actorEmail,
      actorRole,
      action,
      payload.asset_id || "",
      oldText,
      newText,
      noteText,
      source,
      requestId,
      entityId,
    ];
    try {
      await queueSheetWrite(db, addDoc, collection, "Audit_Log", sheetRow, {
        kind: action,
        aid: payload.asset_id || "",
        audit_id: auditId,
        entity_id: entityId,
      });
    } catch (e) {
      console.warn("[recordAudit] sheet mirror queue failed:", e);
    }
  }

  return payload;
}
