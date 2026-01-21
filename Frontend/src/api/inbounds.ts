import axios from "axios";

export const api = axios.create({
  baseURL: "http://192.168.50.6:4000/api", // <-- your laptop IP
  headers: { "Content-Type": "application/json" },
});


export type ClaimSessionPayload = {
  outerBoxId: string;
  innerBoxId: string;
  expectedQty: number;
  packedBy: string;
};

export async function claimSession(payload: ClaimSessionPayload) {
  return api.post("/inbounds/sessions/claim", payload);
}

export async function heartbeat(sessionId: number, packedBy: string) {
  return api.post(`/inbounds/sessions/${sessionId}/heartbeat`, { packedBy });
}

export type CreateInboundItemPayload = {
  sessionId: number;
  sku: string;
  serialNumber: string;
  packedBy: string;
};

export async function createInboundItem(payload: CreateInboundItemPayload) {
  return api.post("/inbounds/items", payload);
}

export async function completeSession(sessionId: number, packedBy: string) {
  return api.post(`/inbounds/sessions/${sessionId}/complete`, { packedBy });
}

export async function abandonSession(sessionId: number, packedBy: string) {
  return api.post(`/inbounds/sessions/${sessionId}/abandon`, { packedBy });
}

export async function resetSession(sessionId: number, packedBy: string) {
  return api.post(`/inbounds/sessions/${sessionId}/reset`, { packedBy });
}

export async function validateSku(sessionId: number, sku: string, packedBy: string) {
  return api.post(`/inbounds/sessions/${sessionId}/validate-sku`, { sku, packedBy });
}

export async function adminListSessions(adminPassword: string) {
  return api.get("/admin/inbounds/sessions", {
    headers: { "x-admin-password": adminPassword }
  });
}

export async function adminGetSession(adminPassword: string, sessionId: number) {
  return api.get(`/admin/inbounds/sessions/${sessionId}`, {
    headers: { "x-admin-password": adminPassword }
  });
}

export async function adminUpdateSession(
  adminPassword: string,
  sessionId: number,
  payload: { expectedQty?: number; clearLockedSku?: boolean }
) {
  return api.patch(`/admin/inbounds/sessions/${sessionId}`, payload, {
    headers: { "x-admin-password": adminPassword }
  });
}

export async function adminDeleteItem(adminPassword: string, itemId: number) {
  return api.delete(`/admin/inbounds/items/${itemId}`, {
    headers: { "x-admin-password": adminPassword }
  });
}

export async function adminUpdateItem(
  adminPassword: string,
  itemId: number,
  payload: { sku?: string; serialNumber?: string }
) {
  return api.patch(`/admin/inbounds/items/${itemId}`, payload, {
    headers: { "x-admin-password": adminPassword }
  });
}

export function adminDeleteSession(adminPw: string, sessionId: number) {
  return api.delete(`/admin/inbounds/sessions/${sessionId}`, {
    headers: { "x-admin-password": adminPw },
  });
}

export function deleteSessionByBox(payload: {
  outerBoxId: string;
  innerBoxId: string;
  packedBy: string;
}) {
  // ✅ correct: uses backend baseURL (http://192.168.50.6:4000/api)
  return api.post("/inbounds/sessions/delete-by-box", payload);
}

export function deleteBatchItems(payload: {
  sessionId: number;
  packedBy: string;
  serialNumbers: string[];
}) {
  return api.post("/inbounds/items/delete-batch", payload);
}

export async function deleteInboundItems(
  sessionId: number | string,
  packedBy: string,
  serialNumbers: string[]
) {
  return api.post("/inbounds/items/delete-batch", {
    sessionId: Number(sessionId),
    packedBy,
    serialNumbers,
  });
}