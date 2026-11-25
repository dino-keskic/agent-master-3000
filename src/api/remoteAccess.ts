/** Remote access (Wi-Fi / Tailscale) listener status, HTTPS serve, and keep-awake APIs. */

import { RemoteAccessStatus } from '../../shared/http/remoteAccess';
import { post, request } from './http';

export const remoteAccessApi = {
  getRemoteAccess: () => request<RemoteAccessStatus>('/api/remote-access'),
  enableRemoteAccess: () => post<RemoteAccessStatus>('/api/remote-access/enable'),
  disableRemoteAccess: () => post<RemoteAccessStatus>('/api/remote-access/disable'),
  enableTailscaleHttps: () => post<RemoteAccessStatus>('/api/remote-access/tailscale/https/enable'),
  disableTailscaleHttps: () => post<RemoteAccessStatus>('/api/remote-access/tailscale/https/disable'),
  setRemoteKeepAwake: (enabled: boolean) =>
    post<RemoteAccessStatus>('/api/remote-access/keep-awake', { enabled })
};
