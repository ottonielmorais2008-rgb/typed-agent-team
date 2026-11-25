export function parseJsonPayload(text: string): unknown {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("The model returned an empty response.");
  }
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced ? fenced[1] : trimmed).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model response did not contain a JSON object.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("The model response was not valid JSON.");
  }
}
