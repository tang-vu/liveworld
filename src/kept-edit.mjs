export const KEPT_PROMPTS = {
  calm: "Redesign this mobile checkout so it feels calmer and more premium. Keep the same words and the same layout. Use a quiet cream palette.",
  keep: "Redesign this mobile checkout so it feels calmer. The Pay $48 button must stay large, dark, high contrast, and in the same place, with those words still readable.",
};

export function keptEditRequest(body) {
  if (!body || (body.mode !== "calm" && body.mode !== "keep"))
    throw new Error(
      "Choose the calm redesign or the redesign that must keep the control.",
    );
  if (
    typeof body.imageDataUrl !== "string" ||
    !body.imageDataUrl.startsWith("data:image/png;base64,") ||
    body.imageDataUrl.length < 40 ||
    body.imageDataUrl.length > 2_000_000
  )
    throw new Error("The screen must be a PNG under the size limit.");
  return {
    mode: body.mode,
    imageDataUrl: body.imageDataUrl,
    prompt: KEPT_PROMPTS[body.mode],
  };
}
