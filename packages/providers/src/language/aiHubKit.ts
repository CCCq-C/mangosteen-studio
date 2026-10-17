const providerPrefix = "aiHubKit:";

export function aihubkitLanguageProviderId(groupId: string) {
  const group = groupId.trim();
  if (!group || group.length > 200) throw new Error("AIHubKit 文本模型分组无效");
  return `${providerPrefix}${group}`;
}

export function aihubkitLanguageGroupId(providerId: string) {
  if (!providerId.startsWith(providerPrefix)) return;
  const group = providerId.slice(providerPrefix.length).trim();
  return group && group.length <= 200 ? group : undefined;
}
