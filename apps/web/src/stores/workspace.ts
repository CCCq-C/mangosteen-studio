import { defineStore } from "pinia";
import { ref } from "vue";
import axios from "axios";
import type { AgentAttachment } from "@/components/agent/types";

export type Project = {
  directory: string;
  name: string;
  lastOpenedAt: number;
};

export type PendingImageGeneration = {
  directory: string;
  prompt: string;
};

export const useWorkspaceStore = defineStore("workspace", () => {
  const project = ref<Project | null>(null);
  const projectList = ref<Project[]>([]);
  const pendingAgentMessage = ref<{ directory: string; prompt: string; attachments?: AgentAttachment[]; model: string; reasoningEffort: string } | null>(null);
  const pendingImageGeneration = ref<PendingImageGeneration | null>(null);

  async function openProject(path: string, previousDirectory = path, signal?: AbortSignal) {
    const { data } = await axios.get<{ code: number; data?: { directory: string }; message?: string }>("/api/workspaces/check", {
      params: { directory: path }, headers: { "x-toonflow-workspace": "1" }, signal,
    });
    signal?.throwIfAborted();
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "工作目录校验失败");
    const checkedDirectory = data.data.directory;
    pendingAgentMessage.value = null;
    pendingImageGeneration.value = null;
    const existing = projectList.value.find(project => project.directory === previousDirectory)
      ?? projectList.value.find(project => project.directory === checkedDirectory);
    project.value = { directory: checkedDirectory, name: existing?.name || checkedDirectory.split(/[\\/]/).filter(Boolean).at(-1) || checkedDirectory, lastOpenedAt: Date.now() };
    projectList.value = [
      project.value,
      ...projectList.value.filter(item => item.directory !== previousDirectory && item.directory !== checkedDirectory),
    ];
  }

  function renameProject(path: string, name: string) {
    const target = projectList.value.find(item => item.directory === path);
    if (!target || !name.trim()) return;
    target.name = name.trim();
    if (project.value?.directory === path) project.value = target;
  }

  function removeProject(path: string) {
    projectList.value = projectList.value.filter(item => item.directory !== path);
    if (project.value?.directory === path) project.value = null;
  }

  function queueImageGeneration(request: PendingImageGeneration) {
    pendingAgentMessage.value = null;
    pendingImageGeneration.value = { ...request };
  }

  function consumeImageGeneration(directory: string) {
    const request = pendingImageGeneration.value;
    if (!request || request.directory !== directory) return;
    pendingImageGeneration.value = null;
    return request;
  }

  return { project, projectList, pendingAgentMessage, pendingImageGeneration, openProject, renameProject, removeProject, queueImageGeneration, consumeImageGeneration };
}, {
  persist: {
    key: "toonflow.projectList",
    pick: ["project", "projectList"],
  },
});
