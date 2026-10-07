/** Host header values a local client uses to reach the webhook, with or without a port. */
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i

export function isLocalHost(host: string | undefined): boolean {
  return typeof host === 'string' && LOCAL_HOST.test(host)
}
