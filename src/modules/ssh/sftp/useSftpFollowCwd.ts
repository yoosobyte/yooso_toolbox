import { useCallback, useEffect, useRef, useState } from "react";

import { shellCwd } from "../../../api";
import { onTerminalOutput } from "../../../events";
import { FOLLOW_KEY } from "./utils";
import { loadStored, migrateStored, saveStored } from "../../../storage";

/**
 * 「跟随终端 cwd」开关及同步逻辑：
 * 轮询兜底 + 终端输出后立即检查，只在 shell 目录真正变化时跳转。
 */
export function useSftpFollowCwd(
  sessionId: string | null,
  path: string,
  loadDir: (target: string) => Promise<void>,
) {
  const [follow, setFollow] = useState(true);
  const [followLoaded, setFollowLoaded] = useState(false);
  const lastFollowCwd = useRef<string | null>(null);
  const pathRef = useRef("");
  pathRef.current = path;
  const followRef = useRef(follow);
  followRef.current = follow;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  /* 跟随开关存在后端凭据库 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      await migrateStored(FOLLOW_KEY, "sftp.follow");
      const raw = await loadStored("sftp.follow");
      if (alive) {
        if (raw !== null) setFollow(raw !== "0");
        setFollowLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!followLoaded) return;
    void saveStored("sftp.follow", follow ? "1" : "0");
  }, [follow, followLoaded]);

  const checkCwd = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!followRef.current || !sid) return;
    try {
      const cwd = await shellCwd(sid);
      if (!cwd || cwd === lastFollowCwd.current) return;
      lastFollowCwd.current = cwd;
      // 只在 shell 目录真正变化时跳转，避免把用户手动浏览的目录拉回去
      if (cwd !== pathRef.current) {
        await loadDir(cwd);
      }
    } catch {
      /* 单次读取失败忽略，下次再试 */
    }
  }, [loadDir]);

  /* 兜底轮询（终端没输出时也能同步，例如长时间运行的任务结束后） */
  useEffect(() => {
    if (!follow || !sessionId) return;
    void checkCwd();
    const timer = window.setInterval(() => void checkCwd(), 5000);
    return () => window.clearInterval(timer);
  }, [follow, sessionId, checkCwd]);

  /* 终端一有输出就立即检查：cd 回车后提示符回显即跟随，几乎没有延迟 */
  useEffect(() => {
    if (!follow || !sessionId) return;
    let timer: number | null = null;
    const unsubscribe = onTerminalOutput((sid) => {
      if (sid !== sessionId) return;
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void checkCwd();
      }, 180);
    });
    return () => {
      unsubscribe();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [follow, sessionId, checkCwd]);

  return { follow, setFollow };
}
