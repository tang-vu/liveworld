let connection;
async function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("liveworld-projects", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Browser project storage is unavailable."));
  });
  return connection;
}
export async function loadAutosave() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("projects", "readonly")
      .objectStore("projects")
      .get("autosave");
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
export async function saveAutosave(project) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    tx.objectStore("projects").put(project, "autosave");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error ?? new Error("Autosave was interrupted."));
  });
}
