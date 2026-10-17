<template>
  <section class="usageLogs" :aria-busy="loading">
    <header class="usageHeader">
      <div class="usageHeading">
        <strong>当前账户使用记录</strong>
        <el-text size="small" type="info">实际扣费来自山竹账户日志，最终以账单记录为准。</el-text>
      </div>
      <el-button :icon="IconRefresh" :loading="loading" :disabled="loading" @click="refreshLogs">刷新</el-button>
    </header>

    <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" showIcon />
    <el-skeleton v-if="loading && !loaded" :rows="6" animated />
    <template v-else>
      <el-table
        v-loading="loading"
        class="usageTable"
        :data="items"
        rowKey="id"
        stripe
        size="small"
        emptyText="暂无使用记录"
        @row-click="showDetails">
        <el-table-column label="时间" width="148">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="modelName" label="模型" minWidth="152" showOverflowTooltip>
          <template #default="{ row }">{{ row.modelName || "—" }}</template>
        </el-table-column>
        <el-table-column prop="groupName" label="分组" minWidth="110" showOverflowTooltip>
          <template #default="{ row }">{{ row.groupName || "—" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="72" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.type)" effect="light" size="small">{{ statusLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="用量" minWidth="136">
          <template #default="{ row }">
            {{ formatTokens(row) }}
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="76" align="right">
          <template #default="{ row }">{{ formatDuration(row.useTime) }}</template>
        </el-table-column>
        <el-table-column label="实际扣费" width="116" align="right">
          <template #default="{ row }"><strong>{{ amountFormat.format(row.amount) }} 额度</strong></template>
        </el-table-column>
        <el-table-column label="" width="58" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="showDetails(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="total > pageSize"
        class="usagePagination"
        :currentPage="page"
        :pageSize="pageSize"
        :total="total"
        :disabled="loading"
        :pagerCount="5"
        layout="total, prev, pager, next"
        size="small"
        @currentChange="changePage" />
      <el-text v-else-if="total" class="usageTotal" size="small" type="info">共 {{ integerFormat.format(total) }} 条记录</el-text>
    </template>

    <el-drawer v-model="detailVisible" title="日志详情" size="460px" append-to-body>
      <template v-if="selectedLog">
        <el-alert
          v-if="selectedLog.type === 5"
          class="detailAlert"
          title="这次请求没有成功"
          :description="selectedLog.detailMessage || '上游没有返回更多错误说明。'"
          type="error"
          :closable="false"
          showIcon />
        <el-descriptions :column="1" border>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(selectedLog.type)" effect="light" size="small">
              {{ statusLabel(selectedLog.type) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="时间">{{ formatTime(selectedLog.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="模型">{{ selectedLog.modelName || "—" }}</el-descriptions-item>
          <el-descriptions-item label="分组">{{ selectedLog.groupName || "—" }}</el-descriptions-item>
          <el-descriptions-item label="用量">{{ formatTokens(selectedLog) }}</el-descriptions-item>
          <el-descriptions-item label="耗时">{{ formatDuration(selectedLog.useTime) }}</el-descriptions-item>
          <el-descriptions-item label="实际扣费">
            <strong>{{ amountFormat.format(selectedLog.amount) }} 额度</strong>
          </el-descriptions-item>
          <el-descriptions-item v-if="selectedLog.statusCode !== undefined" label="状态码">
            {{ selectedLog.statusCode }}
          </el-descriptions-item>
          <el-descriptions-item v-if="selectedLog.errorType" label="错误类型">
            {{ selectedLog.errorType }}
          </el-descriptions-item>
          <el-descriptions-item v-if="selectedLog.errorCode" label="错误代码">
            {{ selectedLog.errorCode }}
          </el-descriptions-item>
          <el-descriptions-item label="请求编号">
            <span class="requestId">{{ selectedLog.requestId || "—" }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-drawer>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { IconRefresh } from "@tabler/icons-vue";
import { locale } from "@toonflow/i18n/vue";
import { loadAihubkitUsageLogs, type AihubkitUsageLog } from "@/lib/aihubkitUsage";

const { visible = true } = defineProps<{ visible?: boolean }>();
const pageSize = 20;
const page = ref(1);
const total = ref(0);
const items = ref<AihubkitUsageLog[]>([]);
const loading = ref(false);
const loaded = ref(false);
const errorMessage = ref("");
const detailVisible = ref(false);
const selectedLog = ref<AihubkitUsageLog>();
const integerFormat = computedFormat({ maximumFractionDigits: 0 });
const amountFormat = computedFormat({ maximumFractionDigits: 6 });
let loadRequest = 0;

function computedFormat(options: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(locale.value, options);
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(locale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatDuration(value: number) {
  if (!value) return "—";
  if (value < 60) return `${amountFormat.format(value)} 秒`;
  return `${amountFormat.format(value / 60)} 分钟`;
}

function formatTokens(value: unknown) {
  const log = value as AihubkitUsageLog;
  if (!log.promptTokens && !log.completionTokens) return "—";
  return `输入 ${integerFormat.format(log.promptTokens)} · 输出 ${integerFormat.format(log.completionTokens)}`;
}

function statusLabel(type: number) {
  if (type === 5) return "错误";
  if (type === 2) return "成功";
  return "记录";
}

function statusType(type: number): "danger" | "success" | "info" {
  if (type === 5) return "danger";
  if (type === 2) return "success";
  return "info";
}

function showDetails(value: unknown) {
  selectedLog.value = value as AihubkitUsageLog;
  detailVisible.value = true;
}

async function loadLogs() {
  const request = ++loadRequest;
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await loadAihubkitUsageLogs({ page: page.value, pageSize });
    if (request !== loadRequest) return;
    page.value = result.page;
    total.value = result.total;
    items.value = result.items;
  } catch (cause) {
    if (request === loadRequest) errorMessage.value = cause instanceof Error ? cause.message : "使用日志读取失败，请重试";
  } finally {
    if (request === loadRequest) {
      loading.value = false;
      loaded.value = true;
    }
  }
}

function refreshLogs() {
  page.value = 1;
  void loadLogs();
}

function changePage(value: number) {
  page.value = value;
  void loadLogs();
}

watch(() => visible, value => {
  if (value) refreshLogs();
}, { immediate: true });
</script>

<style scoped lang="scss">
.usageLogs {
  display: grid;
  gap: 14px;

  .usageHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px;
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-extra-light);

    .usageHeading {
      display: grid;
      gap: 6px;
    }
  }

  .usagePagination {
    justify-self: end;
  }

  .usageTable :deep(.el-table__row) {
    cursor: pointer;
  }

  .usageTotal {
    justify-self: end;
  }

  @media (max-width: 600px) {
    .usageHeader {
      align-items: flex-start;
      flex-direction: column;
    }
  }
}

.detailAlert {
  margin-bottom: 16px;
}

.requestId {
  word-break: break-all;
}
</style>
