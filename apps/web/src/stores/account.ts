import axios from "axios";
import { defineStore } from "pinia";
import { ref } from "vue";
import { clearAihubkitUsage } from "@/lib/aihubkitUsage";
import { clearAihubkitCatalogState, startAihubkitCatalogSync } from "@/lib/aihubkitCatalog";

export interface PublicAccount {
  id: number;
  displayName: string;
}

interface ApiResponse<T> {
  code: number;
  data: T | null;
  message: string;
}

type SessionResult = { authenticated: true; user: PublicAccount } | { authenticated: false; user: null };

const client = axios.create({
  baseURL: "/api/desktop/account",
  timeout: 25_000,
  headers: { "x-toonflow-desktop": "1" },
});

function requestError(cause: unknown) {
  if (axios.isAxiosError<{ message?: unknown }>(cause)) {
    const message = cause.response?.data?.message;
    if (typeof message === "string" && message.trim()) return message;
    if (cause.code === "ECONNABORTED") return "账户服务请求超时，请重试";
  }
  return cause instanceof Error && cause.message ? cause.message : "账户服务请求失败，请重试";
}

async function post<T>(path: string, body: unknown = {}) {
  const response = await client.post<ApiResponse<T>>(path, body);
  if (response.data.code !== 200) throw new Error(response.data.message || "账户服务请求失败");
  return response.data.data;
}

function validAccount(value: unknown): value is PublicAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<PublicAccount>;
  return Number.isSafeInteger(account.id)
    && (account.id as number) > 0
    && typeof account.displayName === "string"
    && Boolean(account.displayName.trim());
}

function readSession(value: unknown): SessionResult {
  if (!value || typeof value !== "object" || typeof (value as Partial<SessionResult>).authenticated !== "boolean") {
    throw new Error("账户状态返回异常，请重试");
  }
  const session = value as Partial<SessionResult>;
  if (session.authenticated) {
    if (!validAccount(session.user)) throw new Error("账户状态返回异常，请重试");
    return { authenticated: true, user: session.user };
  }
  return { authenticated: false, user: null };
}

export const useAccountStore = defineStore("account", () => {
  const status = ref<"unknown" | "authenticated" | "unauthenticated">("unknown");
  const user = ref<PublicAccount | null>(null);
  const errorMessage = ref("");
  let restoring: Promise<void> | undefined;

  function applySession(session: SessionResult) {
    clearAihubkitUsage();
    if (!session.authenticated) {
      clearAihubkitCatalogState();
      user.value = null;
      status.value = "unauthenticated";
      return;
    }
    if (user.value?.id !== session.user.id) clearAihubkitCatalogState();
    user.value = session.user;
    status.value = "authenticated";
    startAihubkitCatalogSync();
  }

  function restore() {
    if (status.value !== "unknown") return Promise.resolve();
    if (restoring) return restoring;
    errorMessage.value = "";
    restoring = post<SessionResult>("/session")
      .then((result) => applySession(readSession(result)))
      .catch((cause) => {
        errorMessage.value = requestError(cause);
        throw cause;
      })
      .finally(() => {
        restoring = undefined;
      });
    return restoring;
  }

  async function requestVerification(email: string) {
    errorMessage.value = "";
    try {
      await post("/verification", { email });
    } catch (cause) {
      errorMessage.value = requestError(cause);
      throw cause;
    }
  }

  async function register(input: { username: string; password: string; email: string; code: string }) {
    errorMessage.value = "";
    try {
      await post("/register", input);
    } catch (cause) {
      errorMessage.value = requestError(cause);
      throw cause;
    }
  }

  async function login(username: string, password: string) {
    errorMessage.value = "";
    try {
      const result = readSession(await post<SessionResult>("/login", { username, password }));
      if (!result.authenticated) throw new Error("登录状态返回异常，请重试");
      applySession(result);
    } catch (cause) {
      errorMessage.value = requestError(cause);
      throw cause;
    }
  }

  async function logout() {
    errorMessage.value = "";
    try {
      const result = readSession(await post<SessionResult>("/logout"));
      if (result.authenticated) throw new Error("退出状态返回异常，请重试");
      applySession(result);
    } catch (cause) {
      errorMessage.value = requestError(cause);
      throw cause;
    }
  }

  return {
    status,
    user,
    errorMessage,
    restore,
    requestVerification,
    register,
    login,
    logout,
  };
});
