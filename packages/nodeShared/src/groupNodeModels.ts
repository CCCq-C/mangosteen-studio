import type { NodeAiModel, NodeMediaModel } from "@toonflow/nodes-scaffold/nodeAi";

type NodeModelChoice = Pick<NodeAiModel, "providerId" | "providerLabel" | "modelId">
  & Partial<Pick<NodeMediaModel, "groupId" | "groupLabel" | "groupRatio" | "priceLabel">>;

export function nodeModelValue(model: Pick<NodeModelChoice, "providerId" | "modelId" | "groupId">) {
  return JSON.stringify(model.groupId ? [model.providerId, model.groupId, model.modelId] : [model.providerId, model.modelId]);
}

export function nodeModelLabel(model: Pick<NodeModelChoice, "modelId" | "priceLabel"> & { label?: string }) {
  const label = model.label || model.modelId;
  return `${label}${model.priceLabel ? ` · ${model.priceLabel}` : ""}`;
}

export function groupNodeModels<T extends NodeModelChoice>(models: readonly T[]) {
  return [...Map.groupBy(models, item => item.groupId ? JSON.stringify([item.providerId, item.groupId]) : item.providerId)].map(([id, items]) => ({
    id,
    label: items[0]!.groupLabel
      ? `${items[0]!.groupLabel}${items[0]!.groupRatio === undefined ? "" : ` · ${items[0]!.groupRatio}×`}`
      : items[0]!.providerLabel,
    models: items,
  })).sort((left, right) => Number(right.id === "tfRouter") - Number(left.id === "tfRouter"));
}
