<template>
  <el-dialog v-model="visible" title="兑换码充值" width="min(440px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose :showClose="!submitting" :closeOnClickModal="false" :closeOnPressEscape="!submitting">
    <el-form class="topupForm" labelPosition="top" :disabled="submitting" @submit.prevent="submit">
      <el-form-item label="兑换码">
        <el-input v-model="key" type="password" showPassword clearable autocomplete="off" :maxlength="512" placeholder="请输入或粘贴兑换码" aria-label="兑换码" @keydown.enter.prevent="submit" />
      </el-form-item>
      <el-text size="small" type="info">兑换成功后会自动刷新当前账户余额。</el-text>
      <el-alert v-if="errorMessage" class="topupError" :title="errorMessage" type="error" :closable="false" showIcon />
    </el-form>
    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">立即兑换</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { redeemAihubkitCode } from "@/lib/aihubkitUsage";

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ redeemed: [] }>();
const key = ref("");
const submitting = ref(false);
const errorMessage = ref("");
const canSubmit = computed(() => Boolean(key.value.trim()) && !submitting.value);

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  errorMessage.value = "";
  try {
    await redeemAihubkitCode(key.value);
    key.value = "";
    visible.value = false;
    emit("redeemed");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "兑换码充值失败，请重试";
  } finally {
    submitting.value = false;
  }
}

watch(visible, opened => {
  if (!opened || submitting.value) return;
  key.value = "";
  errorMessage.value = "";
});
</script>

<style lang="scss" scoped>
.topupForm {
  .topupError { margin-top: 16px; }
}
</style>
