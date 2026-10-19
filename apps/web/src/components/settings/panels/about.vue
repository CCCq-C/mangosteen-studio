<template>
  <div class="about">
    <header class="brand">
      <img class="brandLogo" :src="logoUrl" alt="山竹漫剧" />
      <div>
        <h3>山竹漫剧</h3>
        <p>短剧与漫剧创作工作台</p>
      </div>
    </header>

    <el-card class="infoCard" shadow="never">
      <dl class="productInfo">
        <div>
          <dt>当前版本</dt>
          <dd>v{{ currentVersion }}</dd>
        </div>
        <div>
          <dt>数据位置</dt>
          <dd>项目素材保存在你选择的本地工作目录</dd>
        </div>
      </dl>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import logoUrl from "@toonflow/assets/mangosteenAvatar.png";

const currentVersion = import.meta.env.appVersion || "0.1.1";
</script>

<style lang="scss" scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 14px;

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0 12px;

    .brandLogo {
      width: 60px;
      height: 60px;
      flex-shrink: 0;
      border-radius: 18px;
      object-fit: cover;
      box-shadow: var(--el-box-shadow-light);
    }

    h3 {
      margin: 0 0 5px;
      color: var(--el-text-color-primary);
      font-size: 20px;
      font-weight: 600;
    }

    p {
      margin: 0;
      color: var(--el-text-color-secondary);
      font-size: 13px;
    }
  }

  .infoCard {
    border-radius: var(--ui-radius);

    :deep(.el-card__body) {
      padding: 16px;
    }
  }

  .productInfo {
    display: grid;
    gap: 14px;
    margin: 0;

    div {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr);
      gap: 12px;
    }

    dt {
      color: var(--el-text-color-secondary);
      font-size: 13px;
    }

    dd {
      margin: 0;
      color: var(--el-text-color-primary);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
  }

}
</style>
