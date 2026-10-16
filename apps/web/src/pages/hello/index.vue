<template>
  <main class="hello">
    <div class="pageLanguage"><languageSelect popover /></div>
    <section class="welcomePanel" aria-labelledby="welcomeTitle">
      <div class="authContent">
        <div class="authBrand">
          <img class="brandLogo" :src="logoUrl" alt="" />
          <div>
            <h1 id="welcomeTitle">{{ activeTab === "login" ? "登录山竹漫剧" : "注册山竹漫剧" }}</h1>
            <p>登录后进入短剧与漫剧创作工作台</p>
          </div>
        </div>

        <el-tabs v-model="activeTab" class="authTabs" stretch>
          <el-tab-pane label="登录" name="login">
            <el-form
              ref="loginFormRef"
              :model="loginForm"
              :rules="loginRules"
              labelPosition="top"
              @submit.prevent="submitLogin">
              <el-form-item label="用户名或邮箱" prop="username">
                <el-input
                  v-model="loginForm.username"
                  autocomplete="username"
                  maxlength="254"
                  placeholder="请输入用户名或邮箱" />
              </el-form-item>
              <el-form-item label="密码" prop="password">
                <el-input
                  v-model="loginForm.password"
                  type="password"
                  autocomplete="current-password"
                  maxlength="128"
                  placeholder="请输入密码"
                  showPassword
                  @keyup.enter="submitLogin" />
              </el-form-item>
              <el-button class="submitButton" type="primary" nativeType="submit" :loading="submitting">
                登录并进入工作台
              </el-button>
            </el-form>
          </el-tab-pane>

          <el-tab-pane label="注册" name="register">
            <el-form
              ref="registerFormRef"
              :model="registerForm"
              :rules="registerRules"
              labelPosition="top"
              @submit.prevent="submitRegister">
              <el-form-item label="用户名" prop="username">
                <el-input
                  v-model="registerForm.username"
                  autocomplete="username"
                  maxlength="64"
                  placeholder="设置登录用户名" />
              </el-form-item>
              <el-form-item label="邮箱" prop="email">
                <el-input
                  v-model="registerForm.email"
                  type="email"
                  autocomplete="email"
                  maxlength="254"
                  placeholder="用于接收验证码" />
              </el-form-item>
              <el-form-item label="邮箱验证码" prop="code">
                <div class="codeRow">
                  <el-input
                    v-model="registerForm.code"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="32"
                    placeholder="请输入验证码" />
                  <el-button
                    :loading="sendingCode"
                    :disabled="codeSeconds > 0 || submitting"
                    @click="sendVerification">
                    {{ codeSeconds > 0 ? codeSeconds + " 秒" : "发送验证码" }}
                  </el-button>
                </div>
              </el-form-item>
              <el-form-item label="密码" prop="password">
                <el-input
                  v-model="registerForm.password"
                  type="password"
                  autocomplete="new-password"
                  maxlength="128"
                  placeholder="至少 8 个字符"
                  showPassword
                  @keyup.enter="submitRegister" />
              </el-form-item>
              <el-button class="submitButton" type="primary" nativeType="submit" :loading="submitting">
                注册山竹漫剧
              </el-button>
            </el-form>
          </el-tab-pane>
        </el-tabs>

        <div v-if="feedback" class="authFeedback" role="alert">
          <el-alert :title="feedback" type="error" :closable="false" showIcon />
          <el-button v-if="account.status === 'unknown'" :loading="checkingSession" @click="retrySession">
            重试连接
          </el-button>
        </div>
      </div>

      <footer class="pageFooter">
        <p>© {{ new Date().getFullYear() }} 山竹漫剧</p>
        <p>基于 Toonflow v2.0.6 构建</p>
      </footer>
    </section>

    <div class="artPanel" aria-hidden="true">
      <bg class="artBg" />
      <div class="artBrand">
        <img class="artLogo" :src="logoUrl" alt="" />
        <span class="artName">山竹漫剧</span>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import logoUrl from "@toonflow/assets/mangosteenAvatar.png";
import { useAccountStore } from "@/stores/account";
import { useHelloStore } from "@/stores/hello";
import bg from "./bg.vue";
import languageSelect from "@/components/languageSelect.vue";

const router = useRouter();
const account = useAccountStore();
const hello = useHelloStore();
const activeTab = ref<"login" | "register">("login");
const loginFormRef = ref<FormInstance>();
const registerFormRef = ref<FormInstance>();
const submitting = ref(false);
const sendingCode = ref(false);
const checkingSession = ref(false);
const formError = ref("");
const codeSeconds = ref(0);
const loginForm = reactive({ username: "", password: "" });
const registerForm = reactive({ username: "", email: "", code: "", password: "" });
let codeTimer: ReturnType<typeof setInterval> | undefined;

const loginRules: FormRules = {
  username: [{ required: true, message: "请输入用户名或邮箱", trigger: "blur" }],
  password: [{ required: true, message: "请输入密码", trigger: "blur" }],
};
const registerRules: FormRules = {
  username: [
    { required: true, message: "请输入用户名", trigger: "blur" },
    { max: 64, message: "用户名不能超过 64 个字符", trigger: "blur" },
  ],
  email: [
    { required: true, message: "请输入邮箱", trigger: "blur" },
    { type: "email", message: "请输入有效邮箱", trigger: "blur" },
  ],
  code: [{ required: true, message: "请输入邮箱验证码", trigger: "blur" }],
  password: [
    { required: true, message: "请输入密码", trigger: "blur" },
    { min: 8, message: "密码至少需要 8 个字符", trigger: "blur" },
  ],
};
const feedback = computed(() => formError.value || account.errorMessage);

function startCodeCountdown() {
  if (codeTimer) clearInterval(codeTimer);
  codeSeconds.value = 60;
  codeTimer = setInterval(() => {
    codeSeconds.value--;
    if (codeSeconds.value <= 0 && codeTimer) {
      clearInterval(codeTimer);
      codeTimer = undefined;
    }
  }, 1000);
}

async function sendVerification() {
  if (sendingCode.value || codeSeconds.value > 0) return;
  const valid = await registerFormRef.value?.validateField("email").then(() => true, () => false);
  if (!valid) return;
  sendingCode.value = true;
  formError.value = "";
  try {
    await account.requestVerification(registerForm.email.trim());
    startCodeCountdown();
    ElMessage.success("验证码已发送，请检查邮箱");
  } catch {
    // Store 已提供可读错误。
  } finally {
    sendingCode.value = false;
  }
}

async function submitRegister() {
  if (submitting.value) return;
  const valid = await registerFormRef.value?.validate().then(() => true, () => false);
  if (!valid) return;
  submitting.value = true;
  formError.value = "";
  try {
    await account.register({
      username: registerForm.username.trim(),
      email: registerForm.email.trim(),
      code: registerForm.code.trim(),
      password: registerForm.password,
    });
    loginForm.username = registerForm.username.trim();
    loginForm.password = "";
    registerForm.password = "";
    registerForm.code = "";
    activeTab.value = "login";
    ElMessage.success("注册成功，请使用新账号登录");
  } catch {
    // Store 已提供可读错误。
  } finally {
    submitting.value = false;
  }
}

async function submitLogin() {
  if (submitting.value) return;
  const valid = await loginFormRef.value?.validate().then(() => true, () => false);
  if (!valid) return;
  submitting.value = true;
  formError.value = "";
  try {
    await account.login(loginForm.username.trim(), loginForm.password);
    loginForm.password = "";
    await hello.complete();
    await router.replace("/home");
  } catch (cause) {
    if (account.status === "authenticated") {
      formError.value = cause instanceof Error ? cause.message : "登录成功，但客户端初始化失败，请重试";
    }
  } finally {
    submitting.value = false;
  }
}

async function retrySession() {
  if (checkingSession.value) return;
  checkingSession.value = true;
  formError.value = "";
  try {
    await account.restore();
    if (account.status === "authenticated") await router.replace("/home");
  } catch {
    // Store 已提供可读错误。
  } finally {
    checkingSession.value = false;
  }
}

onBeforeUnmount(() => {
  if (codeTimer) clearInterval(codeTimer);
  loginForm.password = "";
  registerForm.password = "";
});
</script>

<style lang="scss" scoped>
.hello {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 100svh;
  padding: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-family: "Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;

  .pageLanguage {
    position: fixed;
    top: 16px;
    inset-inline-end: calc(50% + 8px);
    z-index: 2;
    max-width: calc(50% - 24px);
  }

  .welcomePanel {
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    gap: 28px;
    min-width: 0;
    min-height: 620px;
    padding: 48px clamp(24px, 4.4vw, 64px);

    .authContent {
      grid-row: 2;
      width: min(100%, 440px);
      justify-self: center;

      .authBrand {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 24px;

        .brandLogo {
          width: 52px;
          height: 52px;
          flex-shrink: 0;
          border-radius: 16px;
          object-fit: cover;
          box-shadow: var(--el-box-shadow-light);
        }

        h1 {
          margin: 0 0 4px;
          font-size: clamp(28px, 3vw, 36px);
          font-weight: 650;
          line-height: 1.3;
          letter-spacing: -0.6px;
        }

        p {
          margin: 0;
          color: var(--el-text-color-secondary);
          font-size: 14px;
          line-height: 1.6;
        }
      }

      .authTabs {
        :deep(.el-tabs__header) {
          margin-bottom: 22px;
        }

        :deep(.el-form-item) {
          margin-bottom: 18px;
        }

        .codeRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          width: 100%;

          .el-button {
            min-width: 112px;
          }
        }

        .submitButton {
          width: 100%;
          min-height: 46px;
          margin-top: 4px;
          border-radius: calc(var(--ui-radius) * 1.25);
          font-size: 15px;
          font-weight: 600;
        }
      }

      .authFeedback {
        display: grid;
        gap: 10px;
        margin-top: 16px;

        .el-button {
          justify-self: start;
        }
      }
    }

    .pageFooter {
      grid-row: 3;
      align-self: end;
      color: var(--el-text-color-secondary);
      font-size: 12px;

      p {
        margin: 4px 0 0;
        line-height: 1.5;
      }
    }
  }

  .artPanel {
    position: relative;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 28px;
    border-radius: calc(var(--ui-radius) * 1.125);
    overflow: hidden;
    background: radial-gradient(ellipse at 76% 82%, #f3dcb1 0%, transparent 46%), radial-gradient(ellipse at 25% 52%, #667ab5 0%, transparent 52%),
      radial-gradient(ellipse at 90% 18%, #369889 0%, transparent 48%), linear-gradient(145deg, #123f38, #467f72 48%, #a8c9ad);

    .artBg {
      z-index: 0;
    }

    .artBrand {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #fff;

      .artLogo {
        width: 46px;
        height: 46px;
        border-radius: 14px;
        object-fit: cover;
        box-shadow: 0 8px 24px rgb(22 45 40 / 22%);
      }

      .artName {
        font-size: 30px;
        font-weight: 600;
        letter-spacing: 0.4px;
      }
    }
  }

  @media (max-width: 800px) {
    grid-template-columns: 1fr;

    .pageLanguage {
      inset-inline-end: 16px;
      max-width: calc(100% - 32px);
    }

    .welcomePanel {
      min-height: 100svh;
      padding: 72px 20px 28px;
    }

    .artPanel {
      display: none;
    }
  }

  @media (max-width: 420px) {
    .welcomePanel .authContent {
      .authBrand {
        align-items: flex-start;

        .brandLogo {
          width: 46px;
          height: 46px;
        }
      }

      .authTabs .codeRow {
        grid-template-columns: 1fr;

        .el-button {
          width: 100%;
        }
      }
    }
  }
}
</style>
