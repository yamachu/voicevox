import {
  createRouter,
  createWebHistory,
  createWebHashHistory,
  RouteRecordRaw,
} from "vue-router";
import EditorHome from "../views/EditorHome.vue";

const routes: Array<RouteRecordRaw> = [
  {
    path: "/home",
    component: EditorHome,
    props: (route) => ({ projectFilePath: route.query["projectFilePath"] }),
  },
];

const router = createRouter({
  // NOTE: Vue CLI Plugin Electron Builderから暗黙的に渡されている
  // FIXME: Build toolsなどを変更した場合はDefinePluginなどで渡すこと
  history: process.env.IS_ELECTRON
    ? createWebHashHistory(process.env.BASE_URL)
    : createWebHistory(process.env.BASE_URL),
  routes,
});

export default router;
