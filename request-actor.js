export function resolveRequestRole({ remoteAddress = '', configuredAdminLanAddress = '', requestedRole = '' } = {}) {
  if (String(requestedRole).trim().toLowerCase() === 'member') return 'member';

  const remote = normalizeRemoteAddress(remoteAddress);
  const adminLanAddress = normalizeRemoteAddress(configuredAdminLanAddress);
  if (isLoopbackAddress(remote)) return 'admin';
  if (adminLanAddress && remote === adminLanAddress) return 'admin';
  return 'member';
}

export function normalizeRemoteAddress(address) {
  return String(address || '').replace(/^::ffff:/, '');
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === 'localhost';
}
