/**
 * 极简事件总线：终端收到远端输出时广播，SFTP 面板据此立刻检查一次 shell 当前目录。
 * 用全局总线而不是 props，是为了避免每次按键都触发 React 重渲染。
 */
type Listener = (sessionId: string) => void;

const listeners = new Set<Listener>();

export function emitTerminalOutput(sessionId: string): void {
  for (const listener of listeners) {
    listener(sessionId);
  }
}

export function onTerminalOutput(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
