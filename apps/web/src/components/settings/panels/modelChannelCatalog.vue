<template>
  <modelCatalog :visible="visible" />
</template>

<script setup lang="ts">
import modelCatalog from "../modelCatalog.vue";

const { visible = true } = defineProps<{ visible?: boolean }>();
</script>
