import { createRouter, createWebHashHistory } from "vue-router";
import { useAccountStore } from "@/stores/account";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/hello",
    },
    {
      path: "/hello",
      component: () => import("@/pages/hello/index.vue"),
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
  ],
});

router.beforeEach(async (to) => {
  const account = useAccountStore();
  if (account.status === "unknown") {
    try {
      await account.restore();
    } catch {
      return to.path === "/hello" ? true : { path: "/hello", replace: true };
    }
  }
  if (account.status === "authenticated" && to.path === "/hello") {
    return { path: "/home", replace: true };
  }
  if (account.status !== "authenticated" && to.path !== "/hello") {
    return { path: "/hello", replace: true };
  }
  return true;
});

export default router;
