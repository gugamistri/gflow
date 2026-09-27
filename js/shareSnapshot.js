/**
 * Snapshot publicado no link de preview — sem writeToken nem IndexedDB.
 */
import { projectToDemoPayload } from "./projects.js";
import { embedImagesInDemo } from "./exportPack.js";

/**
 * Payload do tour sem campos locais (share, id, histórico).
 * why: o JSON público não pode carregar o writeToken do autor.
 */
export function prepareSharePayload(project) {
  const payload = projectToDemoPayload(project);
  delete payload.share;
  delete payload.id;
  delete payload.createdAt;
  delete payload.updatedAt;
  return payload;
}

/**
 * Tour com imagens embutidas, pronto para upload.
 */
export async function buildShareSnapshot(project, { onProgress, embed = embedImagesInDemo } = {}) {
  const payload = prepareSharePayload(project);
  const embedded = await embed(payload, onProgress);
  delete embedded.share;
  delete embedded.id;
  return embedded;
}

export function shareViewUrl(id, origin = typeof location !== "undefined" ? location.origin : "") {
  const base = String(origin || "").replace(/\/$/, "");
  return `${base}/v/${id}`;
}

/**
 * Garante que o JSON serializado não vaza o writeToken.
 */
export function assertShareSnapshotSafe(demo, writeToken) {
  const raw = JSON.stringify(demo);
  if (demo?.share) {
    throw new Error("share_field_present");
  }
  if (writeToken && raw.includes(writeToken)) {
    throw new Error("write_token_leaked");
  }
  return true;
}
