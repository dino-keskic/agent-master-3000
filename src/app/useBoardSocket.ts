import { useEffect, useRef, useState } from 'react';
import { BoardTask, ProjectFolder, TaskLogItem, WebSocketMessage } from '../../shared/types';

/**
 * The live feed the board runs on.
 *
 * Everything that happens inside a turn reaches the browser through this
 * socket, so it has to come back on its own after the server restarts. The
 * handlers are read through a ref: a reconnect drops the transcript deltas
 * that arrive while it is down, and nothing about a render should cost that.
 */

const RECONNECT_DELAY_MS = 3000;

export interface BoardSocketHandlers {
  /** A task as the server now sees it, plus one streamed transcript line. */
  onSnapshot: (task: BoardTask, log?: TaskLogItem) => void;
  onProjects: (projects: ProjectFolder[]) => void;
  onTaskDeleted: (taskId: string) => void;
}

/** True while the socket is up. */
export function useBoardSocket(handlers: BoardSocketHandlers): boolean {
  const [isConnected, setIsConnected] = useState(false);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (!unmounted) setIsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as WebSocketMessage;
          switch (msg.type) {
            case 'PROJECTS_UPDATED':
              latest.current.onProjects(msg.projects);
              break;
            case 'TASK_DELETED':
              latest.current.onTaskDeleted(msg.taskId);
              break;
            case 'TASK_UPDATED':
            case 'TASK_LOG':
            case 'TASK_STATUS_CHANGED':
            case 'TASK_AWAITING_INPUT':
            case 'ERROR':
              latest.current.onSnapshot(msg.task, msg.type === 'TASK_LOG' ? msg.log : undefined);
              break;
          }
        } catch (e) {
          console.error('WebSocket payload error:', e);
        }
      };

      socket.onclose = () => {
        if (unmounted) return;
        setIsConnected(false);
        reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, []);

  return isConnected;
}
