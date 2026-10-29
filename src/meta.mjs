import {
  buildObjectPrompt,
  parseImageStream,
  recordsOfKind,
  decodeMaskToSVGPath,
} from "@meta-sam/parser";
import {
  sparkReservation,
  SPARK_INPUT_USD,
  SPARK_OUTPUT_USD,
  SAM_IMAGE_USD,
  MUSE_IMAGE_USD,
} from "./budget.mjs";

export class MetaClient {
  constructor(config, ledger, transport = fetch) {
    this.config = config;
    this.ledger = ledger;
    this.transport = transport;
  }
  async chat(messages, options = {}) {
    if (!this.config.key)
      throw new Error("Add MODEL_API_KEY to .env.local to enable Meta.");
    const maxOutput = options.maxOutput ?? 2048;
    if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 4096)
      throw new Error("Output token cap is invalid.");
    const body = {
      model: this.config.model,
      messages,
      max_completion_tokens: maxOutput,
      reasoning_effort: "low",
      store: false,
      ...options.format,
      ...options.tools,
    };
    const reservation = await this.ledger.reserve(
      "spark",
      sparkReservation(maxOutput),
      { model: this.config.model },
    );
    let settled = false;
    try {
      const response = await this.transport(
        `${this.config.baseURL}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90_000),
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new Error(
          `Meta returned HTTP ${response.status}. No automatic retry was made.`,
        );
      const data = await response.json();
      const usage = data.usage;
      const known =
        Number.isSafeInteger(usage?.prompt_tokens) &&
        usage.prompt_tokens >= 0 &&
        Number.isSafeInteger(usage?.completion_tokens) &&
        usage.completion_tokens >= 0;
      const cost = known
        ? usage.prompt_tokens * SPARK_INPUT_USD +
          usage.completion_tokens * SPARK_OUTPUT_USD
        : null;
      await this.ledger.settle(reservation, cost, known ? usage : null);
      settled = true;
      if (!known)
        throw new Error(
          "Meta did not return token usage. Paid requests are paused for cost review.",
        );
      const choice = data.choices?.[0];
      if (!choice?.message)
        throw new Error("Meta returned no assistant message.");
      if (choice.finish_reason === "length")
        throw new Error(
          "Meta reached the output cap. No automatic retry was made.",
        );
      if (choice.message.refusal)
        throw new Error("Meta declined this request.");
      return {
        message: choice.message,
        usage,
        costUsd: cost,
        receiptId: reservation,
      };
    } catch (error) {
      if (!settled) await this.ledger.settle(reservation, null).catch(() => {});
      if (/^Meta /.test(error.message)) throw error;
      throw new Error(
        "The Meta request did not complete. Paid requests are paused if the charge is uncertain.",
      );
    }
  }

  async editImage(imageDataUrl, prompt) {
    if (!this.config.key)
      throw new Error("Add MODEL_API_KEY to .env.local to enable Meta.");
    if (typeof prompt !== "string" || !prompt.trim())
      throw new Error("The redesign instruction is empty.");
    const reservation = await this.ledger.reserve("image", MUSE_IMAGE_USD, {
      model: "muse-image-1.0",
    });
    let settled = false;
    try {
      const response = await this.transport(
        `${this.config.baseURL}/images/edits`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "muse-image-1.0",
            prompt,
            images: [{ image_url: imageDataUrl }],
            n: 1,
            output_format: "png",
            reasoning_strength: "low",
            tool_enablement: {
              enable_web_search: false,
              enable_image_search: false,
              enable_shell: false,
            },
          }),
          signal: AbortSignal.timeout(180_000),
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new Error(
          `Meta image edit returned HTTP ${response.status}. No automatic retry was made.`,
        );
      const data = await response.json();
      const encoded = data.data?.[0]?.b64_json;
      if (typeof encoded !== "string" || !encoded)
        throw new Error("Meta image edit returned no image.");
      await this.ledger.settle(reservation, MUSE_IMAGE_USD, { images: 1 });
      settled = true;
      return {
        imageDataUrl: `data:image/png;base64,${encoded}`,
        costUsd: MUSE_IMAGE_USD,
        receiptId: reservation,
      };
    } catch (error) {
      if (!settled) await this.ledger.settle(reservation, null).catch(() => {});
      if (/^Meta /.test(error.message)) throw error;
      throw new Error(
        "The image edit did not complete. Paid requests are paused if the charge is uncertain.",
      );
    }
  }

  async segment(image, objects) {
    if (!this.config.key) throw new Error("Configure the Meta key first.");
    const text = buildObjectPrompt({
      size: { width: image.width, height: image.height },
      objects: objects.map((o, i) => ({
        id: i + 1,
        prompts: [{ box: o.box }],
      })),
    });
    const reservation = await this.ledger.reserve("sam", SAM_IMAGE_USD, {
      model: "sam-3.1",
    });
    let settled = false;
    try {
      const response = await this.transport(
        `${this.config.baseURL}/responses`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sam-3.1",
            stream: true,
            input: [
              {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text },
                  { type: "input_image", image_url: image.dataUrl },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(90_000),
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new Error(`Meta segmentation returned HTTP ${response.status}.`);
      const result = await parseImageStream(readSse(response.body)).finalResult;
      await this.ledger.settle(reservation, SAM_IMAGE_USD, { images: 1 });
      settled = true;
      if (result.outcome.status !== "completed")
        throw new Error("Meta segmentation ended before completion.");
      const masks = recordsOfKind(result.records, "mask");
      const boxes = recordsOfKind(result.records, "box");
      return objects.map((object, index) => {
        const id = String(index + 1);
        const mask = masks.find((m) => m.objectId === id);
        const box = boxes.find((b) => b.objectId === id);
        if (mask && (mask.mask.width > 2048 || mask.mask.height > 2048))
          throw new Error("Segmentation mask exceeds the supported size.");
        return {
          ...object,
          box: box
            ? {
                left: box.left,
                top: box.top,
                right: box.right,
                bottom: box.bottom,
              }
            : object.box,
          mask: mask
            ? {
                path: decodeMaskToSVGPath(mask.mask),
                bounds: mask.bounds,
                width: mask.mask.width,
                height: mask.mask.height,
              }
            : null,
          segmented: Boolean(mask),
        };
      });
    } catch (error) {
      if (!settled) await this.ledger.settle(reservation, null).catch(() => {});
      if (/^(Meta |Segmentation )/.test(error.message)) throw error;
      throw new Error(
        "Segmentation could not be completed. No automatic retry was made.",
      );
    }
  }
}

export async function* readSse(body) {
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > 12_000_000)
      throw new Error("Meta stream exceeded the response size limit.");
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (event.type) yield event;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) throw new Error("Meta stream ended in a partial event.");
}

const objectSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    role: { type: "string", enum: ["source", "house", "bridge", "obstacle"] },
    left: { type: "integer" },
    top: { type: "integer" },
    right: { type: "integer" },
    bottom: { type: "integer" },
  },
  required: ["label", "role", "left", "top", "right", "bottom"],
  additionalProperties: false,
};

export function validateImage(input) {
  if (
    !input ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 32 ||
    input.height < 32 ||
    input.width > 1024 ||
    input.height > 1024
  )
    throw new Error("Upload an image resized to 32–1024 pixels per side.");
  if (
    typeof input.dataUrl !== "string" ||
    input.dataUrl.length > 3_000_000 ||
    !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(input.dataUrl)
  )
    throw new Error("Use a JPEG or PNG image under 2 MB.");
  const bytes = Buffer.from(input.dataUrl.split(",")[1], "base64");
  if (bytes.length < 32 || bytes.length > 2_000_000)
    throw new Error("Image file size is not supported.");
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216;
  if (!png && !jpeg) throw new Error("Image signature is invalid.");
  return { width: input.width, height: input.height, dataUrl: input.dataUrl };
}

export async function scanTabletop(client, input, emit = () => {}) {
  const image = validateImage(input);
  emit({ type: "scan", message: "Muse Spark is locating tabletop objects." });
  const response = await client.chat(
    [
      {
        role: "system",
        content:
          "You interpret tabletop scenes for a small logistics game. Locate 2–12 separate physical objects. Assign tentative roles: one source (cup/well), houses (small blocks/containers), bridges (long objects), obstacles (stones/other objects). These are suggestions for user confirmation. Ignore the table, background, drawings, and shadows. Return boxes in actual image pixels. Identify at most one source and four bridges. If no suitable objects are visible, return an empty objects array. Never invent an object.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Image size: ${image.width} × ${image.height} pixels. Find the physical objects and suggest roles.`,
          },
          { type: "image_url", image_url: { url: image.dataUrl } },
        ],
      },
    ],
    {
      maxOutput: 2048,
      format: {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "tabletop_scene",
            strict: true,
            schema: {
              type: "object",
              properties: { objects: { type: "array", items: objectSchema } },
              required: ["objects"],
              additionalProperties: false,
            },
          },
        },
      },
    },
  );
  let parsed;
  try {
    parsed = JSON.parse(response.message.content);
  } catch {
    throw new Error("Scene detection returned invalid JSON.");
  }
  if (!Array.isArray(parsed.objects) || parsed.objects.length > 12)
    throw new Error("Scene detection returned an invalid object list.");
  const objects = parsed.objects.map((o, i) => {
    if (
      typeof o.label !== "string" ||
      !["source", "house", "bridge", "obstacle"].includes(o.role)
    )
      throw new Error("Invalid detected object.");
    const coordinates = [o.left, o.top, o.right, o.bottom];
    if (
      coordinates.some((n) => !Number.isInteger(n)) ||
      o.left < 0 ||
      o.top < 0 ||
      o.right > image.width ||
      o.bottom > image.height ||
      o.right <= o.left ||
      o.bottom <= o.top
    )
      throw new Error("A detected box falls outside the image.");
    return {
      id: `object-${i + 1}`,
      label: o.label.slice(0, 60),
      role: o.role,
      box: { left: o.left, top: o.top, right: o.right, bottom: o.bottom },
    };
  });
  if (!objects.length)
    return {
      objects: [],
      width: image.width,
      height: image.height,
      confirmed: false,
    };
  emit({ type: "scan", message: "SAM 3.1 is tracing the objects." });
  const segmented = await client.segment(image, objects);
  return {
    objects: segmented,
    width: image.width,
    height: image.height,
    confirmed: false,
    models: ["muse-spark-1.3", "sam-3.1"],
  };
}
