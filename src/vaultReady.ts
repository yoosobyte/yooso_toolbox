/**
 * 凭据库就绪闸门。
 *
 * 桌面端的加密凭据库是「自动解锁」的（异步），在解锁完成前读 secrets 会拿到一份空数据；
 * 如果这时候把默认值当成真实设置加载进内存，重启后就表现为「设置被重置」。
 * 所以 storage.ts 里的读写都先等这里放行。
 */
let release: (() => void) | null = null;

export const vaultReady: Promise<void> = new Promise<void>((resolve) => {
  release = resolve;
});

/** 由 VaultGate 在确认凭据库可用（或浏览器调试环境）后调用一次 */
export function markVaultReady(): void {
  release?.();
  release = null;
}
