/** Local record guard: this module stays import-free so node --test can load it. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A provider/model pair, mirroring protocol 3.9. */
export type ModelSelectionLike = {
  provider: string;
  model: string;
  reasoningEffort?: string;
};

/** One selectable model, normalized from the raw GET /v1/models payload. */
export type ModelChoice = ModelSelectionLike & {
  /** Stable key for lists: provider + "/" + model. */
  key: string;
  label: string;
  description?: string;
};

/** One provider group, as shown in the model picker. */
export type ModelGroup = { id: string; name: string; choices: ModelChoice[] };

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/** provider/model key, used to compare the current selection. */
export function selectionKey(selection: ModelSelectionLike | undefined): string {
  if (!selection) return "";
  return selection.provider + "/" + selection.model;
}

function readChoice(
  raw: unknown,
  groupId: string,
): ModelChoice | undefined {
  if (typeof raw === "string") {
    const model = text(raw);
    if (!model) return undefined;
    return { provider: groupId, model, key: groupId + "/" + model, label: model };
  }
  const entry = asRecord(raw);
  if (!entry) return undefined;
  const provider =
    text(entry.provider) ??
    text(entry.providerId) ??
    text(entry.provider_id) ??
    text(entry.providerName) ??
    text(entry.group) ??
    groupId;
  const model =
    text(entry.model) ??
    text(entry.modelId) ??
    text(entry.id) ??
    text(entry.slug) ??
    text(entry.value);
  if (!model) return undefined;
  const label =
    text(entry.label) ??
    text(entry.name) ??
    text(entry.displayName) ??
    text(entry.title) ??
    model;
  const description =
    text(entry.description) ??
    text(entry.tagline) ??
    text(entry.subtitle) ??
    (label !== model ? model : undefined);
  const reasoningEffort =
    text(entry.defaultReasoningEffort) ?? text(entry.reasoningEffort);
  return {
    provider,
    model,
    key: provider + "/" + model,
    label,
    description,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

/** Extracts a selection from whatever shape a `default` field takes. */
export function readSelection(value: unknown): ModelSelectionLike | undefined {
  if (typeof value === "string") {
    const [provider, ...rest] = value.split("/");
    return provider && rest.length > 0
      ? { provider, model: rest.join("/") }
      : undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const provider =
    text(record.provider) ?? text(record.providerId) ?? text(record.provider_id);
  const model =
    text(record.model) ?? text(record.modelId) ?? text(record.id) ?? text(record.name);
  if (!provider || !model) return undefined;
  const reasoningEffort =
    text(record.reasoningEffort) ?? text(record.reasoning_effort);
  return { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

/**
 * Normalizes the raw DSH model catalog (protocol 3.9) into picker groups.
 * Unknown shapes yield an empty list instead of throwing, so the screen still
 * works if the host reports capabilities.models = false.
 */
export function normalizeModelCatalog(catalog: unknown): ModelGroup[] {
  const record = asRecord(catalog);
  if (!record) return [];
  const rawGroups = Array.isArray(record.groups)
    ? record.groups
    : Array.isArray(record.providers)
      ? record.providers
      : [];
  const groups: ModelGroup[] = [];
  rawGroups.forEach((rawGroup, groupIndex) => {
    const group = asRecord(rawGroup);
    if (!group) {
      const id = text(rawGroup);
      if (id) {
        groups.push({
          id,
          name: id,
          choices: [{ provider: id, model: id, key: id + "/" + id, label: id }],
        });
      }
      return;
    }
    const id = text(group.id) ?? text(group.provider) ?? "group-" + groupIndex;
    const name = text(group.name) ?? text(group.label) ?? text(group.title) ?? id;
    const rawModels = Array.isArray(group.models)
      ? group.models
      : Array.isArray(group.items)
        ? group.items
        : Array.isArray(group.entries)
          ? group.entries
          : [];
    const choices: ModelChoice[] = [];
    const seen = new Set<string>();
    rawModels.forEach((rawModel) => {
      const choice = readChoice(rawModel, id);
      if (!choice || seen.has(choice.key)) return;
      seen.add(choice.key);
      choices.push(choice);
    });
    if (choices.length > 0) groups.push({ id, name, choices });
  });
  return groups;
}

/** The catalog's default selection, if it has one. */
export function defaultSelection(catalog: unknown): ModelSelectionLike | undefined {
  const record = asRecord(catalog);
  if (!record) return undefined;
  return (
    readSelection(record.default) ??
    readSelection(record.defaultSelection) ??
    readSelection(record.lastUsed)
  );
}

/** Finds the normalized choice matching a selection. */
export function findChoice(
  groups: readonly ModelGroup[],
  selection: ModelSelectionLike | undefined,
): ModelChoice | undefined {
  if (!selection) return undefined;
  const key = selectionKey(selection);
  for (const group of groups) {
    for (const choice of group.choices) {
      if (selectionKey(choice) === key) return choice;
    }
  }
  return undefined;
}

/** The short label for the header chip: the model's own name, not the provider. */
export function modelChipLabel(
  groups: readonly ModelGroup[],
  selection: ModelSelectionLike | undefined,
): string | undefined {
  const choice = findChoice(groups, selection);
  if (choice) return choice.label;
  if (selection?.model) return selection.model;
  return undefined;
}

/** Flattens groups into one list, for search or a single picker section. */
export function flattenChoices(groups: readonly ModelGroup[]): ModelChoice[] {
  return groups.flatMap((group) => group.choices);
}
