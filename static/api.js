export async function postPerspective(dataUrl, points) {
  const response = await fetch("/api/perspective", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl, points }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Perspektive konnte nicht korrigiert werden.");
  }
  return payload;
}

export async function postRemoveBackground(dataUrl) {
  const response = await fetch("/api/remove-background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: dataUrl }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Hintergrund konnte nicht entfernt werden.");
  }
  return payload;
}

export async function postExport(dataUrl, format, compression, includeImage) {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: dataUrl,
      format,
      compression,
      include_image: includeImage,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Export konnte nicht erstellt werden.");
  }
  return payload;
}

export async function postSession(dataUrl) {
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (response.ok) {
      const payload = await response.json();
      return payload.session_id ?? null;
    }
  } catch {
    // best effort
  }
  return null;
}

export async function deleteSession(id) {
  if (!id) return;
  try {
    await fetch(`/api/session/${id}`, { method: "DELETE" });
  } catch {
    // best effort
  }
}
