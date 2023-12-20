<template>
  <a :href="`${host}/.auth/login/aad`">Login With AAD</a>
</template>

<script setup lang="ts">
import { computed } from "vue";

const host = computed(
  () => JSON.parse(import.meta.env.VITE_DEFAULT_ENGINE_INFOS)[0].host
);
</script>
